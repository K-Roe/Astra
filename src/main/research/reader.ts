import { request as httpRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { URL } from 'node:url';
import {
  assertFetchAllowed,
  isBlockedAddress,
  systemResolver,
  UrlRejected,
  type ApprovedSourceBoundary,
  type HostResolver,
} from './urlGuard';
import { extractReadableText, type ExtractedPage } from './extraction';

/**
 * The only code in Astra that touches the public internet.
 *
 * It can reach an approved HTTPS host and nothing else. Redirects, DNS
 * answers and the address actually connected to are all re-checked, and the
 * crawl is bounded on every axis Karl cares about: pages, depth, bytes,
 * documents, redirects, wall time and request rate.
 */

export interface CrawlLimits {
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly maxDocuments: number;
  readonly maxDocumentBytes: number;
  readonly maxTotalBytes: number;
  readonly maxRedirects: number;
  readonly requestTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly minDelayMs: number;
  readonly userAgent: string;
}

export const DEFAULT_LIMITS: CrawlLimits = {
  maxPages: 20,
  maxDepth: 1,
  maxDocuments: 25,
  maxDocumentBytes: 2_000_000,
  maxTotalBytes: 8_000_000,
  maxRedirects: 3,
  requestTimeoutMs: 10_000,
  totalTimeoutMs: 60_000,
  minDelayMs: 500,
  userAgent: 'AstraLocalCompanion/1.0 (local-first personal assistant; single-user desktop app)',
};

export class CrawlBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrawlBudgetError';
  }
}

export interface FetchedPage {
  readonly url: string;
  readonly status: number;
  readonly page: ExtractedPage;
  readonly bytes: number;
  readonly publishedAt: string | null;
  readonly updatedAt: string | null;
}

export interface RobotsPolicy {
  readonly disallow: readonly string[];
  readonly allow: readonly string[];
  readonly crawlDelayMs: number;
}

export const EMPTY_ROBOTS: RobotsPolicy = { disallow: [], allow: [], crawlDelayMs: 0 };

/** Minimal robots.txt parser: User-agent groups, Allow/Disallow, Crawl-delay. */
export function parseRobots(text: string, agentToken = 'AstraLocalCompanion'): RobotsPolicy {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/#.*$/, '').trim());
  let inOurGroup = false;
  let starGroup = false;
  const allow: string[] = [];
  const disallow: string[] = [];
  let crawlDelayMs = 0;

  for (const line of lines) {
    const [rawField, ...rest] = line.split(':');
    if (!rawField) continue;
    const field = rawField.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (field === 'user-agent') {
      const token = value.toLowerCase();
      if (inOurGroup) {
        // A following directive still belongs to the group we are in.
        continue;
      }
      if (token === '*') starGroup = true;
      else if (token.includes(agentToken.toLowerCase())) inOurGroup = true;
      continue;
    }
    if (!inOurGroup && !starGroup) continue;

    if (field === 'disallow' && value) disallow.push(value);
    else if (field === 'allow' && value) allow.push(value);
    else if (field === 'crawl-delay') {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) crawlDelayMs = Math.min(seconds * 1000, 30_000);
    }
  }
  return { disallow, allow, crawlDelayMs };
}

/** Longest-match wins, per the de facto robots rule. */
export function robotsAllows(policy: RobotsPolicy, pathname: string): boolean {
  const match = (rule: string): number => (pathname.startsWith(rule) ? rule.length : -1);
  const bestDisallow = Math.max(...policy.disallow.map(match), -1);
  const bestAllow = Math.max(...policy.allow.map(match), -1);
  return bestAllow >= bestDisallow;
}

/**
 * HTTP GET pinned to a pre-validated address.
 *
 * Pinning is what closes the DNS-rebinding hole: the host is resolved and
 * checked once, then the socket is connected to that exact address rather than
 * letting a second DNS answer choose.
 */
export function pinnedGet(
  url: URL,
  pinnedAddress: string,
  options: { timeoutMs: number; maxBytes: number; userAgent: string; headers?: Record<string, string> },
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string; truncated: boolean; bytes: number }> {
  return new Promise((resolve, reject) => {
    const port = 443;
    const req = httpRequest(
      {
        host: pinnedAddress,
        servername: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        // Never reuse a pooled socket to a different address.
        agent: false,
        headers: {
          host: url.host,
          'user-agent': options.userAgent,
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'accept-encoding': 'identity',
          ...options.headers,
        },
        // Pin the certificate check to the original host name.
        lookup: (_hostname, _opts, callback) => callback(null, pinnedAddress, 4),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        let truncated = false;
        res.on('data', (piece: Buffer) => {
          bytes += piece.length;
          if (bytes > options.maxBytes) {
            truncated = true;
            res.destroy();
            return;
          }
          chunks.push(piece);
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            truncated,
            bytes,
          });
        });
        res.on('error', reject);
      },
    );
    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new Error(`request timed out after ${options.timeoutMs} ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

export interface ReaderDependencies {
  readonly limits?: Partial<CrawlLimits>;
  readonly resolve?: HostResolver;
  readonly get?: typeof pinnedGet;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export interface CrawlResult {
  readonly pages: readonly FetchedPage[];
  readonly visited: readonly string[];
  readonly robots: RobotsPolicy;
  readonly errors: readonly { readonly url: string; readonly reason: string }[];
  readonly truncated: boolean;
}

/**
 * Crawl an approved source, breadth-limited and byte-budgeted.
 * Any page that fails validation is recorded as an error and skipped; it can
 * never widen the crawl.
 */
export async function crawlApprovedSource(
  entryUrl: string,
  boundary: ApprovedSourceBoundary,
  deps: ReaderDependencies = {},
): Promise<CrawlResult> {
  const limits: CrawlLimits = { ...DEFAULT_LIMITS, ...deps.limits };
  const resolve = deps.resolve ?? systemResolver;
  const get = deps.get ?? pinnedGet;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const deadline = now() + limits.totalTimeoutMs;

  const pages: FetchedPage[] = [];
  const visited: string[] = [];
  const errors: { url: string; reason: string }[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  let truncated = false;
  let nextRequestAt = now();

  // robots.txt is fetched through exactly the same validation as any page.
  const robots = await fetchRobots(entryUrl, boundary, limits, get, resolve, errors);

  const queue: { url: string; depth: number }[] = [{ url: entryUrl, depth: 0 }];
  while (queue.length > 0 && pages.length < limits.maxPages && pages.length < limits.maxDocuments) {
    if (now() > deadline) {
      truncated = true;
      break;
    }
    const { url, depth } = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    visited.push(url);

    let target: { url: URL; pinnedAddress: string };
    try {
      target = await assertFetchAllowed(url, boundary, resolve);
    } catch (error) {
      errors.push({ url, reason: error instanceof UrlRejected ? error.reason : String(error) });
      continue;
    }

    if (!robotsAllows(robots, target.url.pathname)) {
      errors.push({ url, reason: 'robots-disallow' });
      continue;
    }

    const wait = nextRequestAt - now();
    if (wait > 0) await sleep(Math.min(wait, limits.totalTimeoutMs));
    const delay = Math.max(limits.minDelayMs, robots.crawlDelayMs);
    nextRequestAt = now() + delay;

    let response: Awaited<ReturnType<typeof pinnedGet>>;
    let currentUrl = url;
    for (let hop = 0; ; hop += 1) {
      if (hop > limits.maxRedirects) {
        errors.push({ url, reason: 'too-many-redirects' });
        response = undefined as never;
        break;
      }
      try {
        response = await get(target.url, target.pinnedAddress, {
          timeoutMs: limits.requestTimeoutMs,
          maxBytes: limits.maxDocumentBytes,
          userAgent: limits.userAgent,
        });
      } catch (error) {
        errors.push({ url, reason: `request-failed: ${error instanceof Error ? error.message : String(error)}` });
        response = undefined as never;
        break;
      }
      const location = typeof response.headers.location === 'string' ? response.headers.location : undefined;
      if (!location || response.status < 300 || response.status > 399) break;
      // Re-validate every redirect hop from scratch.
      const next = new URL(location, target.url).toString();
      try {
        target = await assertFetchAllowed(next, boundary, resolve);
      } catch (error) {
        errors.push({ url: next, reason: error instanceof UrlRejected ? error.reason : String(error) });
        response = undefined as never;
        break;
      }
      currentUrl = next;
    }
    if (!response) continue;

    if (response.status !== 200) {
      errors.push({ url: currentUrl, reason: `http-${response.status}` });
      continue;
    }
    if (response.truncated || totalBytes + response.bytes > limits.maxTotalBytes) {
      truncated = true;
      errors.push({ url: currentUrl, reason: 'size-limit' });
      if (response.truncated) continue;
      break;
    }
    totalBytes += response.bytes;

    const page = extractReadableText(response.body);
    if (page.text.length < 200) {
      errors.push({ url: currentUrl, reason: 'no-readable-content' });
      continue;
    }
    pages.push({
      url: currentUrl,
      status: response.status,
      page,
      bytes: response.bytes,
      publishedAt: headerValue(response.headers, 'last-modified'),
      updatedAt: headerValue(response.headers, 'etag'),
    });

    if (depth < limits.maxDepth) {
      for (const link of page.links) {
        if (queue.length >= limits.maxPages * 4) break;
        let resolvedLink: URL;
        try {
          resolvedLink = new URL(link.href, currentUrl);
        } catch {
          continue;
        }
        try {
          // Same validation as a fetch: links cannot widen the crawl.
          await assertFetchAllowed(resolvedLink.toString(), boundary, resolve);
        } catch {
          continue;
        }
        if (!seen.has(resolvedLink.toString())) {
          queue.push({ url: resolvedLink.toString(), depth: depth + 1 });
        }
      }
    }
  }

  if (queue.length > 0) truncated = true;
  return { pages, visited, robots, errors, truncated };
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const value = headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function fetchRobots(
  entryUrl: string,
  boundary: ApprovedSourceBoundary,
  limits: CrawlLimits,
  get: typeof pinnedGet,
  resolve: HostResolver,
  errors: { url: string; reason: string }[],
): Promise<RobotsPolicy> {
  const robotsUrl = new URL('/robots.txt', entryUrl).toString();
  try {
    // robots.txt lives at the site root, outside the approved path prefix, so
    // it is validated against the same origin with the whole path allowed.
    // Nothing else uses this relaxed boundary.
    const robotsBoundary = { ...boundary, pathPrefix: '/' };
    const target = await assertFetchAllowed(robotsUrl, robotsBoundary, resolve);
    const response = await get(target.url, target.pinnedAddress, {
      timeoutMs: limits.requestTimeoutMs,
      maxBytes: 256_000,
      userAgent: limits.userAgent,
    });
    if (response.status !== 200) return EMPTY_ROBOTS;
    return parseRobots(response.body);
  } catch {
    // No usable robots.txt means no additional restrictions are imposed, but
    // the failure is recorded so it is visible rather than silently ignored.
    errors.push({ url: robotsUrl, reason: 'robots-unavailable' });
    return EMPTY_ROBOTS;
  }
}

/** True when a host resolves to a safe, public address. Used by diagnostics. */
export async function hostLooksSafe(hostname: string, resolve: HostResolver = systemResolver): Promise<boolean> {
  try {
    const addresses = await resolve(hostname);
    return addresses.length > 0 && addresses.every((address) => !isBlockedAddress(address));
  } catch {
    return false;
  }
}

export { dnsLookup };