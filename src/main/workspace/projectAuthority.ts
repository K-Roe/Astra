import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  assertNotReservedName, isIgnoredDirectory, isLinkEntry, isSensitiveFile,
  resolveWithinRootNotRoot, type SandboxOptions,
} from './pathGuard';

/**
 * Project-scoped write authority.
 *
 * Karl approves a project once, and Astra may then create and edit files inside
 * it without asking again. That is a real grant of authority, so it is built to
 * be boring and to fail closed. Five properties do the work:
 *
 *  1. **The scope root must be new.** Authority is only ever granted over a
 *     directory that did not exist when the plan was made and that Astra
 *     created for this task. It therefore can never cover a repository Karl
 *     already had. This is the single most important property in the file.
 *  2. **Containment is re-proved on every write**, through the same
 *     `pathGuard` check every other filesystem tool uses, including the
 *     walk-up check for a path that does not exist yet.
 *  3. **Secrets and dependency directories are never writable**, even inside an
 *     approved project.
 *  4. **Writes are budgeted.** The approval names a maximum number of writes,
 *     so a loop cannot rewrite the project forever under one approval.
 *  5. **Nothing destructive is in scope.** Deletion, anything outside the root,
 *     network access and credential access are refused here and must go through
 *     their own approval. This authority cannot grant them.
 *
 * What this deliberately does *not* do: it never touches the CA-01 or CA-01B
 * per-operation approval path. `assertApproved()` and the scope fingerprint are
 * unchanged, and this module is only reachable from a project build task, which
 * can only exist when the destination was absent.
 */

export interface ProjectAuthority {
  /** Absolute project root, already proven inside the approved root. */
  readonly root: string;
  readonly sandbox: SandboxOptions;
  readonly maxWrites: number;
  /** Absolute deadline; the build loop stops rather than running unbounded. */
  readonly deadline: number;
  writesUsed: number;
}

/** Why a write was refused, in words Karl can act on. */
export class AuthorityRefused extends Error {
  constructor(readonly reason: string, readonly needsSeparateApproval: boolean) {
    super(reason);
    this.name = 'AuthorityRefused';
  }
}

const MAX_FILE_BYTES = 512_000;

/**
 * Mint authority over a directory Astra is about to create.
 *
 * Refuses if anything already exists there. That check is the guarantee that
 * authority can never be pointed at Karl's own work.
 */
export function grantProjectAuthority(candidate: string, sandbox: SandboxOptions, maxWrites: number, deadlineMs: number): ProjectAuthority {
  const root = resolveWithinRootNotRoot(candidate, sandbox);
  if (existsSync(root)) throw new AuthorityRefused(`${root} already exists; project authority is only ever granted over a directory Astra creates`, true);
  const parent = path.dirname(root);
  if (!existsSync(parent)) throw new AuthorityRefused(`the parent directory ${parent} does not exist`, true);
  if (!statSync(parent).isDirectory()) throw new AuthorityRefused(`the parent path ${parent} is not a directory`, true);
  return { root, sandbox, maxWrites, deadline: Date.now() + deadlineMs, writesUsed: 0 };
}

/**
 * Resolve a project-relative path and prove the write is inside the grant.
 *
 * Returns the absolute path, having refused anything that is a traversal, a
 * link, a secret, a dependency directory or over budget.
 */
export function resolveAuthorisedWrite(authority: ProjectAuthority, relative: string, mode: 'create' | 'overwrite'): string {
  if (typeof relative !== 'string' || !relative.trim()) throw new AuthorityRefused('a file path is required', true);
  // A project file is named relative to the project root, never absolutely and
  // never with a drive letter: otherwise "absolute path" would mean anything.
  if (path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.includes('\\')) {
    throw new AuthorityRefused(`"${relative}" must be a path relative to the project root`, true);
  }
  const normalised = path.normalize(relative).replace(/\\/g, '/');
  if (normalised.startsWith('..') || normalised.split('/').includes('..')) {
    throw new AuthorityRefused(`"${relative}" escapes the project root`, true);
  }

  const segments = normalised.split('/').filter(Boolean);
  for (const segment of segments) {
    assertNotReservedName(segment);
    if (isSensitiveFile(segment) || isIgnoredDirectory(segment)) {
      throw new AuthorityRefused(`"${segment}" is a secret or dependency path and is never writable inside an approved project`, true);
    }
  }

  const absolute = path.join(authority.root, ...segments);
  // The authoritative containment check, identical to every other tool's.
  const resolved = resolveWithinRootNotRoot(absolute, authority.sandbox);
  if (path.relative(authority.root, resolved).startsWith('..')) {
    throw new AuthorityRefused(`"${relative}" resolves outside the approved project`, true);
  }
  // A link anywhere in the chain would let a write land somewhere else.
  for (let cursor = authority.root, i = 0; i < segments.length; i += 1) {
    cursor = path.join(cursor, segments[i]);
    if (isLinkEntry(cursor)) throw new AuthorityRefused(`"${segments[i]}" is a link, not a real file`, true);
  }

  const exists = existsSync(absolute);
  if (isIgnoredDirectory(path.basename(absolute)) || isSensitiveFile(path.basename(absolute))) {
    throw new AuthorityRefused(`"${path.basename(absolute)}" is not writable`, true);
  }
  if (mode === 'create' && exists) throw new AuthorityRefused(`${absolute} already exists; creation will not overwrite it`, true);
  if (mode === 'overwrite' && !exists) throw new AuthorityRefused(`${absolute} does not exist`, true);

  if (authority.writesUsed >= authority.maxWrites) {
    throw new AuthorityRefused(`this approval allows ${authority.maxWrites} writes and they are all used; continuing needs a fresh approval`, true);
  }
  return absolute;
}

/**
 * Write one file under the grant, then read it back and verify the bytes.
 *
 * Verification is not optional: a write is only counted as done when an
 * independent read produces exactly the content that was approved. Returns the
 * digest so the caller can prove which bytes are on disk.
 */
export function writeAuthorised(authority: ProjectAuthority, relative: string, content: string): { path: string; bytes: number; sha256: string } {
  if (typeof content !== 'string' || !content.length) throw new AuthorityRefused(`no content was produced for "${relative}"`, false);
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_FILE_BYTES) throw new AuthorityRefused(`"${relative}" is ${bytes} bytes, over the ${MAX_FILE_BYTES} byte limit`, true);

  const exists = existsSync(path.join(authority.root, relative.replace(/\//g, path.sep)));
  const absolute = resolveAuthorisedWrite(authority, relative, exists ? 'overwrite' : 'create');
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');

  const readBack = readFileSync(absolute, 'utf8');
  if (readBack !== content) throw new Error(`verification failed for ${relative}: on-disk content differs from what was written`);
  authority.writesUsed += 1;
  return { path: absolute, bytes, sha256: createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex') };
}

/** True when the grant has run out of time. */
export function authorityExpired(authority: ProjectAuthority): boolean {
  return Date.now() > authority.deadline;
}

/**
 * Classify an operation that this authority must never perform.
 *
 * The build loop consults this before attempting anything irreversible or
 * off-machine, so it can explain the refusal instead of silently skipping it.
 */
export function requiresSeparateApproval(operation: 'delete' | 'network' | 'credentials' | 'outside_project' | 'dependency_install'): boolean {
  return operation === 'delete' || operation === 'network' || operation === 'credentials' || operation === 'outside_project' || operation === 'dependency_install';
}

/** The words Karl sees when the build wants something this grant cannot do. */
export const SEPARATE_APPROVAL_EXPLANATIONS: Readonly<Record<string, string>> = {
  delete: 'deleting anything needs its own approval, including inside this project',
  network: 'reaching the network needs its own approval',
  credentials: 'reading credentials or secrets needs its own approval',
  outside_project: 'touching anything outside the approved project needs its own approval',
  dependency_install: 'installing dependencies needs its own approval, because package managers run arbitrary install scripts',
};

/** True when the path is a symlink or junction rather than a real directory entry. */
export function isRealDirectory(target: string): boolean {
  try { return lstatSync(target).isDirectory(); } catch { return false; }
}