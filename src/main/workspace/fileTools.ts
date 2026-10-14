import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertNotReservedName, resolveWithinRoot, resolveWithinRootNotRoot, type SandboxOptions } from './pathGuard';

/**
 * File mutation, patch application and Git inspection.
 *
 * Every entry point takes an absolute candidate path and re-validates it here,
 * immediately before touching the disk. Nothing in this module executes model
 * text, and no caller can pass a path that leaves the approved root.
 */

export class FileToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileToolError';
  }
}

export const MAX_EDIT_FILE_BYTES = 2_000_000;

export interface WriteResult {
  readonly relativePath: string;
  readonly bytes: number;
  readonly created: boolean;
}

export function writeProjectFile(
  root: string,
  sandbox: SandboxOptions,
  relativePath: string,
  content: string,
): WriteResult {
  if (typeof relativePath !== 'string' || relativePath.length === 0) throw new FileToolError('a file path is required');
  assertNotReservedName(relativePath);

  // Edits are scoped to the repository, not merely to the workspace root:
  // `../sibling-project/file.ts` must not be reachable from inside a repo.
  const scope = repoScope(root, sandbox);
  const target = resolveWithinRootNotRoot(path.resolve(scope.root, relativePath), scope);
  const existed = existsSync(target);
  if (existed && !statSync(target).isFile()) throw new FileToolError('target exists and is not a file');

  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_EDIT_FILE_BYTES) throw new FileToolError(`file too large: ${bytes} bytes`);

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  return { relativePath: path.relative(resolveRoot(sandbox), target), bytes, created: !existed };
}

/** Narrow the sandbox to one repository for the duration of an edit. */
function repoScope(root: string, sandbox: SandboxOptions): SandboxOptions {
  const repo = resolveWithinRoot(root, sandbox);
  return { root: repo, allowLinks: sandbox.allowLinks };
}

export function deleteProjectFile(root: string, sandbox: SandboxOptions, relativePath: string): { readonly relativePath: string } {
  assertNotReservedName(relativePath);
  const scope = repoScope(root, sandbox);
  const target = resolveWithinRootNotRoot(path.resolve(scope.root, relativePath), scope);
  if (!existsSync(target)) throw new FileToolError('no such file');
  rmSync(target, { force: true });
  return { relativePath: path.relative(resolveRoot(sandbox), target) };
}

export interface PatchHunk {
  readonly find: string;
  readonly replace: string;
}

export interface PatchResult {
  readonly applied: number;
  readonly failed: readonly { readonly find: string; readonly reason: string }[];
}

/**
 * Apply structured search-and-replace hunks.
 *
 * Chosen over whole-file replacement so an unexpected edit cannot silently
 * discard unrelated content: a hunk that does not match exactly is reported
 * rather than forced.
 */
export function applyPatch(
  root: string,
  sandbox: SandboxOptions,
  relativePath: string,
  hunks: readonly PatchHunk[],
): { readonly patch: PatchResult; readonly relativePath: string } {
  const scope = repoScope(root, sandbox);
  const target = resolveWithinRootNotRoot(path.resolve(scope.root, relativePath), scope);
  if (!existsSync(target)) throw new FileToolError('no such file');
  const original = readFileSync(target, 'utf8');

  let working = original;
  let applied = 0;
  const failed: { find: string; reason: string }[] = [];

  for (const hunk of hunks) {
    if (!hunk || typeof hunk.find !== 'string' || typeof hunk.replace !== 'string') {
      failed.push({ find: String(hunk?.find ?? ''), reason: 'malformed hunk' });
      continue;
    }
    if (hunk.find === '') {
      failed.push({ find: '', reason: 'an empty search string would match everywhere' });
      continue;
    }
    const index = working.indexOf(hunk.find);
    if (index === -1) {
      failed.push({ find: hunk.find.slice(0, 120), reason: 'text not found in the file' });
      continue;
    }
    if (working.indexOf(hunk.find, index + 1) !== -1) {
      failed.push({ find: hunk.find.slice(0, 120), reason: 'text is ambiguous; it appears more than once' });
      continue;
    }
    working = `${working.slice(0, index)}${hunk.replace}${working.slice(index + hunk.find.length)}`;
    applied += 1;
  }

  if (applied > 0) writeFileSync(target, working, 'utf8');
  return { patch: { applied, failed }, relativePath: path.relative(resolveRoot(sandbox), target) };
}

// -------------------------------------------------------------------- git

export interface GitResult {
  readonly ok: boolean;
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface RunGitOptions {
  readonly timeoutMs?: number;
  readonly maxOutputChars?: number;
}

/**
 * Run git with an argument array and no shell.
 *
 * No string interpolation means a path or branch name cannot inject an
 * argument. `-C <root>` scopes every invocation to one authorised repository.
 */
export function runGit(
  root: string,
  sandbox: SandboxOptions,
  args: readonly string[],
  options: RunGitOptions = {},
): Promise<GitResult> {
  const safeRoot = resolveWithinRoot(root, sandbox);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutput = options.maxOutputChars ?? 400_000;

  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', safeRoot, ...args],
      { timeout: timeoutMs, maxBuffer: maxOutput, windowsHide: true, shell: false },
      (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: unknown }).code === 'number' ? Number((error as { code?: number }).code) : error ? 1 : 0;
        resolve({
          ok: !error,
          code,
          stdout: String(stdout).slice(0, maxOutput),
          stderr: String(stderr).slice(0, maxOutput),
          timedOut: Boolean(error && /timed out|ETIMEDOUT/i.test(String((error as Error).message))),
        });
      },
    );
  });
}

export interface GitStatusSummary {
  readonly branch: string | null;
  readonly staged: number;
  readonly unstaged: number;
  readonly untracked: number;
  readonly lines: readonly string[];
  readonly clean: boolean;
}

export async function gitStatus(root: string, sandbox: SandboxOptions): Promise<GitStatusSummary> {
  const result = await runGit(root, sandbox, ['status', '--porcelain=v1', '--branch']);
  if (!result.ok && !result.stdout) {
    return { branch: null, staged: 0, unstaged:0, untracked: 0, lines: [], clean: true };
  }
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let branch: string | null = null;
  for (const line of lines) {
    if (line.startsWith('##')) {
      branch = line.replace(/^##\s*/, '').split('...')[0] || null;
      continue;
    }
    const x = line[0];
    const y = line[1];
    if (x === '?' && y === '?') untracked += 1;
    else {
      if (x !== ' ' && x !== '?') staged += 1;
      if (y !== ' ' && y !== '?') unstaged += 1;
    }
  }
  return { branch, staged, unstaged, untracked, lines, clean: lines.length === 0 || (lines.length === 1 && lines[0].startsWith('##')) };
}

/** Unquoted repository-relative dirty paths, including names with spaces. */
export async function gitDirtyPaths(root: string, sandbox: SandboxOptions): Promise<string[]> {
  const result = await runGit(root, sandbox, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!result.ok) throw new FileToolError(`git status failed: ${result.stderr.slice(0, 200)}`);
  const entries = result.stdout.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4 || entry[2] !== ' ') throw new FileToolError('unrecognised Git status entry');
    paths.push(entry.slice(3));
    if (entry[0] === 'R' || entry[1] === 'R' || entry[0] === 'C' || entry[1] === 'C') {
      if (++i >= entries.length) throw new FileToolError('incomplete Git rename status');
      paths.push(entries[i]);
    }
  }
  return paths;
}

export interface GitDiff {
  readonly diff: string;
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
}

/** Unified diff of the working tree, or of a staged range when asked. */
export async function gitDiff(
  root: string,
  sandbox: SandboxOptions,
  options: { staged?: boolean; ref?: string; maxChars?: number; paths?: readonly string[] } = {},
): Promise<GitDiff> {
  const maxChars = options.maxChars ?? 200_000;
  const args = options.staged
    ? ['diff', '--cached']
    : options.ref
      ? ['diff', `${options.ref}..HEAD`]
      : ['diff', 'HEAD'];
  const limited = options.paths?.map((file) => path.relative(root, resolveWithinRootNotRoot(path.resolve(root, file), { root }))) ?? [];
  const result = await runGit(root, sandbox, [...args, '--unified=3', ...(limited.length ? ['--', ...limited] : [])]);
  let diff = result.stdout;
  if (!result.ok && !options.staged && !options.ref && limited.length && /unknown revision|ambiguous argument|bad revision/i.test(result.stderr)) {
    // A newly initialised repository has no HEAD. Ask Git for each real file's
    // diff against an empty file; this also includes untracked scaffold files.
    diff = '';
    for (const file of limited) {
      const untracked = await runGit(root, sandbox, ['diff', '--no-index', '--', '/dev/null', file]);
      diff += untracked.stdout;
    }
  } else if (!result.ok) {
    throw new FileToolError(`git diff failed: ${result.stderr.slice(0, 200)}`);
  }
  diff = diff.slice(0, maxChars);
  const filesChanged = (diff.match(/^diff --git /gm) ?? []).length;
  let insertions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) insertions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { diff, filesChanged, insertions, deletions };
}

/** Create a branch. Refuses to clobber an existing one. */
export async function createBranch(root: string, sandbox: SandboxOptions, branch: string): Promise<GitResult> {
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch) || branch.startsWith('-')) {
    return { ok: false, code: 2, stdout: '', stderr: 'invalid branch name', timedOut: false };
  }
  const existing = await runGit(root, sandbox, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (existing.ok) return { ok: false, code: 1, stdout: '', stderr: `branch ${branch} already exists`, timedOut: false };
  return runGit(root, sandbox, ['checkout', '-b', branch]);
}

export function resolveRoot(sandbox: SandboxOptions): string {
  return resolveWithinRoot(sandbox.root, { ...sandbox, allowLinks: true });
}

/** Initialise a brand-new repository directory under the approved root. */
export function ensureNewRepositoryDirectory(root: string, sandbox: SandboxOptions): string {
  const safeRoot = resolveWithinRoot(root, sandbox);
  if (existsSync(safeRoot)) {
    const entries = readdirSync(safeRoot);
    if (entries.length > 0) throw new FileToolError('refusing to use a directory that already has content');
  } else {
    mkdirSync(safeRoot, { recursive: true });
  }
  return safeRoot;
}
