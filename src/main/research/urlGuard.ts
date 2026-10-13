/**
 * URL admission control for approved-source learning.
 *
 * Everything here is deliberately strict and pure where possible so it can be
 * tested without touching the network. The reader may only ever fetch a URL
 * that has already passed `assertFetchAllowed` against an approved source.
 *
 * The threat model is a hostile or compromised page: Astra is told to learn
 * from a legitimate documentation site, and that site (or a DNS entry, or a
 * redirect) tries to make Astra read something else. Defences:
 *
 *  1. Exact host match only. No subdomains, no suffixes, no silent expansion.
 *  2. HTTPS only, standard port only, no credentials in the URL.
 *  3. Path must stay inside the approved prefix.
 *  4. The resolved address of every host is checked, and the address is then
 *     pinned for the connection, so a second DNS answer cannot swap in a
 *     private address (DNS rebinding).
 *  5. Private, loopback, link-local, carrier-grade NAT, multicast, reserved
 *     and cloud metadata addresses are refused, in both IPv4 and IPv6, and
 *     including IPv4-mapped IPv6 spellings.
 */

/** Cloud metadata endpoints must never be reachable, even by accident. */
const METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/** Hostnames that resolve inside the local machine or network. */
const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);

export interface ApprovedSourceBoundary {
  /** Exact origin Astra may fetch from, e.g. `https://react.dev`. */
  readonly origin: string;
  /** Path prefix the crawl may not escape, e.g. `/learn`. Always starts with `/`. */
  readonly pathPrefix: string;
  readonly maxPages: number;
  readonly maxDepth: number;
}

export type UrlRejection =
  | 'malformed'
  | 'not-https'
  | 'credentials-in-url'
  | 'non-standard-port'
  | 'host-not-approved'
  | 'path-outside-boundary'
  | 'local-hostname'
  | 'blocked-address'
  | 'dns-failed'
  | 'too-many-redirects';

export class UrlRejected extends Error {
  constructor(readonly reason: UrlRejection, readonly url: string, detail = '') {
    super(`URL rejected (${reason}): ${url}${detail ? ` - ${detail}` : ''}`);
    this.name = 'UrlRejected';
  }
}

/** Parse an IPv4 dotted quad into a 32-bit integer, or null. */
export function parseIpv4(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = result * 256 + octet;
  }
  return result >>> 0;
}

/** Expand an IPv6 literal, including `::` compression and IPv4 suffixes. */
export function parseIpv6(value: string): number[] | null {
  let text = value.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!text.includes(':')) return null;

  // Rewrite a trailing dotted quad into two hextets.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const [headText, tailText, ...extra] = text.split('::');
  if (extra.length > 0) return null;
  const head = headText ? headText.split(':') : [];
  const tailParts = tailText ? tailText.split(':') : [];
  const missing = 8 - head.length - tailParts.length;
  if (text.includes('::') ? missing < 0 : missing !== 0) return null;

  const groups = text.includes('::')
    ? [...head, ...Array.from({ length: missing }, () => '0'), ...tailParts]
    : head;
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const n = parseInt(group, 16);
    bytes.push((n >>> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

const IPV4_BLOCKS: readonly { readonly base: number; readonly bits: number; readonly why: string }[] = [
  { base: 0x00000000, bits: 8, why: 'this network 0.0.0.0/8' },
  { base: 0x0a000000, bits: 8, why: 'private 10.0.0.0/8' },
  { base: 0x7f000000, bits: 8, why: 'loopback 127.0.0.0/8' },
  { base: 0x64400000, bits: 10, why: 'shared address space 100.64.0.0/10' },
  { base: 0xa9fe0000, bits: 16, why: 'link-local 169.254.0.0/16 and cloud metadata' },
  { base: 0xac100000, bits: 12, why: 'private 172.16.0.0/12' },
  { base: 0xc0a80000, bits: 16, why: 'private 192.168.0.0/16' },
  { base: 0xe0000000, bits: 4, why: 'multicast and reserved 224.0.0.0/4' },
  { base: 0xf0000000, bits: 4, why: 'reserved 240.0.0.0/4' },
];

/** True when an IPv4 address must never be fetched. */
export function isBlockedIpv4(value: string): boolean {
  const address = parseIpv4(value);
  if (address === null) return true;
  if (address === 0xffffffff || address === 0x00000000) return true;
  return IPV4_BLOCKS.some((block) => {
    const mask = block.bits === 0 ? 0 : (0xffffffff << (32 - block.bits)) >>> 0;
    return ((address & mask) >>> 0) === ((block.base & mask) >>> 0);
  });
}

/** True when an IPv6 address must never be fetched. */
export function isBlockedIpv6(value: string): boolean {
  const bytes = parseIpv6(value);
  if (!bytes) return true;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible addresses are judged as IPv4.
  const isMapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const isCompat = bytes.slice(0, 12).every((b) => b === 0);
  if (isMapped || isCompat) {
    const v4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    return isBlockedIpv4(v4);
  }
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) embed an IPv4 address. A NAT64
  // host can otherwise be used to reach 127.0.0.1 or a private network while
  // the literal address looks innocuous.
  const isNat64 = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b;
  const is6to4 = bytes[0] === 0x20 && bytes[1] === 0x02;
  if (isNat64) return isBlockedIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  if (is6to4) return isBlockedIpv4(`${bytes[2]}.${bytes[3]}.${bytes[4]}.${bytes[5]}`);
  if (bytes.every((b) => b === 0)) return true; // :: loopback
  if (bytes[0] === 0xff) return true; // multicast
  const first = bytes[0];
  const second = bytes[1];
  // fe80::/10 link-local, fc00::/7 unique local, fec0::/10 site local
  if (first === 0xfe && (second & 0xc0) === 0x80) return true;
  if ((first & 0xfe) === 0xfc) return true;
  if (first === 0xfe && (second & 0xc0) === 0xc0) return true;
  return false;
}

/** Dispatch on the literal address family. */
export function isBlockedAddress(value: string): boolean {
  const address = value.trim().replace(/^\[|\]$/g, '');
  if (address.includes(':')) return isBlockedIpv6(address);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return isBlockedIpv4(address);
  // Not a literal at all: treat as unsafe rather than guessing.
  return true;
}

/** Resolve function shape, injected so tests never touch real DNS. */
export type HostResolver = (hostname: string) => Promise<string[]>;

export const systemResolver: HostResolver = async (hostname) => {
  const { lookup } = await import('node:dns/promises');
  const result = await lookup(hostname, { all: true, verbatim: true });
  return result.map((entry) => entry.address);
};

export interface ValidatedTarget {
  readonly url: URL;
  /** Address the caller must connect to, preventing DNS rebinding. */
  readonly pinnedAddress: string;
}

/**
 * Validate a URL against an approved source and return the address to pin.
 * Throws `UrlRejected` with a machine-readable reason.
 */
export async function assertFetchAllowed(
  raw: string,
  boundary: ApprovedSourceBoundary,
  resolve: HostResolver = systemResolver,
): Promise<ValidatedTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlRejected('malformed', raw);
  }

  if (url.protocol !== 'https:') throw new UrlRejected('not-https', raw, `scheme ${url.protocol}`);
  if (url.username || url.password) throw new UrlRejected('credentials-in-url', raw);
  if (url.port && url.port !== '443') throw new UrlRejected('non-standard-port', raw, url.port);

  const allowed = new URL(boundary.origin);
  // Exact host match. Not "endsWith", not a registrable-domain check: an
  // approved source is one literal host.
  if (url.hostname.toLowerCase() !== allowed.hostname.toLowerCase()) {
    throw new UrlRejected('host-not-approved', raw, url.hostname);
  }

  const prefix = boundary.pathPrefix.startsWith('/') ? boundary.pathPrefix : `/${boundary.pathPrefix}`;
  if (url.pathname !== prefix && !url.pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)) {
    throw new UrlRejected('path-outside-boundary', raw, url.pathname);
  }

  const hostname = url.hostname.toLowerCase();
  if (METADATA_HOSTS.has(hostname) || LOCAL_HOSTNAMES.has(hostname)) {
    throw new UrlRejected('local-hostname', raw, hostname);
  }

  let addresses: string[];
  if (/^\[.*\]$/.test(url.hostname) || url.hostname.includes(':')) {
    addresses = [url.hostname.replace(/^\[|\]$/g, '')];
  } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = await resolve(hostname);
    } catch (error) {
      throw new UrlRejected('dns-failed', raw, error instanceof Error ? error.message : String(error));
    }
  }

  if (addresses.length === 0) throw new UrlRejected('dns-failed', raw, 'no addresses');
  // Every answer must be safe: a host that returns both a public and a private
  // address is treated as hostile.
  for (const address of addresses) {
    if (isBlockedAddress(address)) throw new UrlRejected('blocked-address', raw, address);
  }

  return { url, pinnedAddress: addresses[0] };
}

/** Safe navigation across redirects; each hop is re-validated and re-pinned. */
export async function followApprovedRedirects(
  startUrl: string,
  boundary: ApprovedSourceBoundary,
  maxRedirects: number,
  fetchImpl: (url: string, pinnedAddress: string, redirect: 'manual') => Promise<Response>,
  resolve: HostResolver = systemResolver,
): Promise<{ response: Response; finalUrl: string }> {
  let current = startUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const { url, pinnedAddress } = await assertFetchAllowed(current, boundary, resolve);
    const response = await fetchImpl(url.toString(), pinnedAddress, 'manual');
    const location = response.headers.get('location');
    if (!location || response.status < 300 || response.status > 399) {
      return { response, finalUrl: url.toString() };
    }
    // Resolve relative redirects against the current URL, then re-validate.
    current = new URL(location, url).toString();
  }
  throw new UrlRejected('too-many-redirects', startUrl, `over ${maxRedirects} hops`);
}