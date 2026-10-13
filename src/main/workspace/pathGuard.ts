import { lstatSync, realpathSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Path containment for the repository sandbox.
 *
 * The only permitted workspace root is `C:\Users\karlr\repos`. Every path that
 * reaches a filesystem tool must pass through `resolveWithinRoot`, both when a
 * task is planned and again immediately before the operation runs, because a
 * symlink or junction can be created in between.
 *
 * Defences:
 *  - Canonicalisation, so `..`, `.` and duplicate separators cannot escape.
 *  - Real resolution of symlinks and Windows junctions via `realpathSync`.
 *  - Walk-up checking: if a path does not exist yet (a file about to be
 *    created), the nearest existing ancestor is resolved and the remainder is
 *    re-joined, so a link higher up still cannot be used to escape.
 *  - Case-insensitive comparison, because Windows paths are.
 *  - Reserved Windows device names are refused: they are not real files and
 *    have confusing behaviour.
 *  - Trailing dots/spaces are stripped for comparison, since Windows ignores
 *    them and they are a classic bypass trick.
 */

export class PathRejected extends Error {
  constructor(readonly reason: string, readonly target: string) {
    super(`path rejected (${reason}): ${target}`);
    this.name = 'PathRejected';
  }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

/** Canonical form used for comparison: resolved, lower-cased, trimmed. */
function canonical(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Windows ignores trailing dots and spaces, so they must not create a bypass. */
function stripTrailingNoise(value: string): string {
  if (process.platform !== 'win32') return value;
  return value.replace(/[. ]+$/, '');
}

/**
 * Resolve as much of `target` as exists, so a not-yet-created file is still
 * checked against any symlink or junction sitting in one of its parents.
 */
function realpathBestEffort(target: string): { resolved: string; existed: boolean } {
  let current = path.resolve(target);
  const tail: string[] = [];
  // Walk up until something exists, remembering what we peeled off.
  for (;;) {
    if (existsSync(current)) {
      let real: string;
      try {
        real = realpathSync(current);
      } catch {
        real = current;
      }
      return { resolved: path.join(real, ...tail.reverse()), existed: tail.length === 0 };
    }
    const parent = path.dirname(current);
    if (parent === current) return { resolved: path.resolve(target), existed: false };
    tail.push(path.basename(current));
    current = parent;
  }
}

/** True when the path or any existing ancestor is a link rather than a real directory. */
function hasLinkComponent(target: string): boolean {
  let current = path.resolve(target);
  for (;;) {
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      // Non-existent is fine; the parent walk continues.
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export interface SandboxOptions {
  /** The one permitted workspace root. */
  readonly root: string;
  /**
   * When false, a symlinked or junctioned path is refused outright instead of
   * being resolved. Use for write targets inside Karl's real projects.
   */
  readonly allowLinks?: boolean;
}

/**
 * Resolve `candidate` and prove it stays inside the sandbox root.
 * Returns the canonical absolute path. Throws `PathRejected` otherwise.
 */
export function resolveWithinRoot(candidate: string, options: SandboxOptions): string {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new PathRejected('empty', String(candidate));
  }
  if (candidate.includes('\u0000')) throw new PathRejected('nul-byte', candidate);

  const rootReal = realpathBestEffort(options.root).resolved;
  const targetReal = realpathBestEffort(candidate).resolved;

  const rootKey = canonical(stripTrailingNoise(rootReal));
  const targetKey = canonical(stripTrailingNoise(targetReal));

  // Compare against the root and every ancestor of the target, so that a
  // sibling directory sharing a prefix (`\repos-evil`) cannot pass.
  if (targetKey !== rootKey && !targetKey.startsWith(rootKey + path.sep)) {
    throw new PathRejected('outside-root', candidate);
  }

  if (options.allowLinks !== true && hasLinkComponent(path.resolve(candidate))) {
    throw new PathRejected('symlinked-path', candidate);
  }

  return targetReal;
}

/** Re-check that a path is inside the root and is not the root itself. */
export function resolveWithinRootNotRoot(candidate: string, options: SandboxOptions): string {
  const resolved = resolveWithinRoot(candidate, options);
  if (canonical(stripTrailingNoise(resolved)) === canonical(stripTrailingNoise(resolveWithinRoot(options.root, { ...options, allowLinks: true })))) {
    throw new PathRejected('is-root', candidate);
  }
  return resolved;
}

/** Refuse reserved Windows device names so reads cannot have odd side effects. */
export function assertNotReservedName(name: string): void {
  const base = path.basename(name).split('.')[0];
  if (WINDOWS_RESERVED.test(base)) throw new PathRejected('reserved-device-name', name);
}

/** True when a directory entry is a symlink or Windows junction/reparse point. */
export function isLinkEntry(target: string): boolean {
  try {
    const stats = lstatSync(target);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Extensions that must never be read into model context or indexed. */
const SENSITIVE_PATTERNS: readonly { readonly test: (name: string) => boolean; readonly why: string }[] = [
  { test: (n) => n === '.env' || n.startsWith('.env.'), why: 'environment file' },
  { test: (n) => /\.(pem|key|pfx|p12|keystore|jks|asc|gpg)$/i.test(n), why: 'key or certificate' },
  // npm accepts a bare `npmrc` on Windows as well as `.npmrc`.
  { test: (n) => /^\.?(npmrc|pypirc|netrc|dockercfg)$/i.test(n), why: 'credential file' },
  { test: (n) => /^id_(rsa|dsa|ecdsa|ed25519)$/i.test(n), why: 'private key' },
  { test: (n) => /^credentials?(\.|$)/i.test(n), why: 'credential file' },
  { test: (n) => /^secrets?(\.|$)/i.test(n), why: 'secret material' },
];

/** True when a filename must be excluded from reads, indexing and context. */
export function isSensitiveFile(name: string): boolean {
  const base = path.basename(name);
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(base));
}

/** Directories that are never worth indexing and may be enormous. */
const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'dist-electron', 'build', 'coverage',
  '.next', '.nuxt', '.cache', '.venv', 'venv', '__pycache__', '.pytest_cache',
  '.gradle', '.idea', '.vscode', 'target', 'out', 'test-results', '.turbo',
]);

export function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name);
}

/** Lockfiles are machine-generated, enormous and useless as project knowledge. */
const LOCKFILES = /^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|cargo\.lock|poetry\.lock|uv\.lock|go\.sum|gemfile\.lock|packages\.lock\.json)$/i;

/** True when a file is worth reading as project knowledge. */
export function isIndexableFile(name: string): boolean {
  const base = path.basename(name);
  if (isIgnoredDirectory(base) || isSensitiveFile(base)) return false;
  if (LOCKFILES.test(base)) return false;
  if (/\.lock$|\.tsbuildinfo$/i.test(base)) return false;
  return true;
}