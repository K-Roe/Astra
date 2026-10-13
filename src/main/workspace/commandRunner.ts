import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveWithinRoot, type SandboxOptions } from './pathGuard';

/**
 * Controlled local command execution.
 *
 * Design rules, in order of importance:
 *
 *  1. Nothing here runs because a model said so. A caller must already hold an
 *     approval, checked by the approval manager before this is reached.
 *  2. No shell. An argument array goes straight to `spawn`, so no value can be
 *     interpolated into a command line.
 *  3. The working directory is always inside the approved repository.
 *  4. `package.json` scripts, installers and test runners execute arbitrary
 *     code by design, so the allowlist is explicit and narrow rather than a
 *     deny-list of scary words.
 *  5. Timeouts kill the whole process tree; output is capped; the result is
 *     recorded for the audit log.
 */

export interface CommandPolicy {
  /** Executables that may be run at all. */
  readonly allowedExecutables: ReadonlySet<string>;
  /** npm/pnpm/yarn subcommands that are permitted. */
  readonly allowedPackageScripts: ReadonlySet<string>;
  readonly maxOutputChars: number;
  readonly defaultTimeoutMs: number;
  readonly maxTimeoutMs: number;
}

export const DEFAULT_COMMAND_POLICY: CommandPolicy = {
  allowedExecutables: new Set(['npm', 'node', 'npx', 'git', 'pnpm', 'yarn', 'python', 'pytest', 'tsc', 'eslint']),
  // `install` is deliberately absent: adding dependencies needs its own approval.
  allowedPackageScripts: new Set(['test', 'run', 'lint', 'build', 'typecheck', 'start']),
  maxOutputChars: 200_000,
  defaultTimeoutMs: 120_000,
  maxTimeoutMs: 600_000,
};

export class CommandRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandRejected';
  }
}

export interface CommandRequest {
  /** Executable name or explicit path, e.g. `npm` or `C:\\tools\\tsc.cmd`. */
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly purpose: string;
  readonly timeoutMs?: number;
}

export interface CommandResult {
  readonly ok: boolean;
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly command: string;
}

function baseName(executable: string): string {
  const normalized = executable.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1).replace(/\.(exe|cmd|bat)$/i, '');
}

/**
 * Decide whether a command may run at all. Separated from execution so the
 * decision can be tested and shown to Karl before anything spawns.
 */
export function assertCommandAllowed(request: CommandRequest, policy: CommandPolicy = DEFAULT_COMMAND_POLICY): void {
  const name = baseName(request.executable);
  if (!policy.allowedExecutables.has(name)) {
    throw new CommandRejected(`executable "${name}" is not in the allowlist`);
  }
  if (request.args.some((arg) => /\s/.test(arg) && /^[-/]/.test(arg))) {
    throw new CommandRejected('arguments may not contain whitespace-prefixed shell syntax');
  }
  // Reject the shapes that only make sense to a shell.
  for (const arg of request.args) {
    if (/[;&|`$><]/.test(arg) && !/^-/.test(arg)) {
      throw new CommandRejected(`argument contains shell metacharacters: ${arg.slice(0, 40)}`);
    }
    if (arg === '--' || arg.startsWith('--eval') || arg === '-c' || arg === '-e') {
      throw new CommandRejected(`argument "${arg}" would execute inline code`);
    }
  }
  if (name === 'npm' || name === 'pnpm' || name === 'yarn') {
    const script = request.args.find((a) => !a.startsWith('-'));
    if (script === 'install' || script === 'i' || script === 'add' || script === 'ci') {
      throw new CommandRejected('installing dependencies requires separate explicit approval');
    }
    if (script === 'run') {
      const target = request.args[request.args.indexOf('run') + 1];
      if (!target || !policy.allowedPackageScripts.has(target)) {
        throw new CommandRejected(`package script "${target ?? 'unknown'}" is not allowed`);
      }
    } else if (script && !policy.allowedPackageScripts.has(script) && script !== 'version' && script !== 'ls') {
      throw new CommandRejected(`package script "${script}" is not allowed`);
    }
  }
}

/** Resolve an executable to an absolute path when one can be found. */
function resolveExecutable(executable: string): string | null {
  if (path.isAbsolute(executable) && existsSync(executable)) return executable;
  const name = baseName(executable);
  const extensions = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  const directories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Run an approved command inside an authorised repository.
 * Never uses a shell; kills the whole tree on timeout.
 */
export async function runApprovedCommand(
  request: CommandRequest,
  sandbox: SandboxOptions,
  policy: CommandPolicy = DEFAULT_COMMAND_POLICY,
): Promise<CommandResult> {
  assertCommandAllowed(request, policy);

  const cwd = resolveWithinRoot(request.cwd, sandbox);
  const executablePath = resolveExecutable(request.executable);
  if (!executablePath) throw new CommandRejected(`could not find executable "${request.executable}"`);

  const timeoutMs = Math.min(request.timeoutMs ?? policy.defaultTimeoutMs, policy.maxTimeoutMs);
  const started = Date.now();
  const display = `${baseName(request.executable)} ${request.args.join(' ')}`.trim();

  return new Promise<CommandResult>((resolve) => {
    const child = spawn(executablePath, [...request.args], {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CI: '1',
        NO_COLOR: '1',
        // Keep tool output non-interactive.
        GIT_TERMINAL_PROMPT: '0',
      },
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;

    const collect = (chunk: Buffer, into: 'out' | 'err'): void => {
      const text = chunk.toString('utf8');
      if (into === 'out') {
        if (stdout.length >= policy.maxOutputChars) { truncated = true; return; }
        stdout += text;
        if (stdout.length > policy.maxOutputChars) { stdout = stdout.slice(0, policy.maxOutputChars); truncated = true; }
      } else {
        if (stderr.length >= policy.maxOutputChars) { truncated = true; return; }
        stderr += text;
        if (stderr.length > policy.maxOutputChars) { stderr = stderr.slice(0, policy.maxOutputChars); truncated = true; }
      }
    };

    child.stdout?.on('data', (c: Buffer) => collect(c, 'out'));
    child.stderr?.on('data', (c: Buffer) => collect(c, 'err'));

    const killTree = (): void => {
      try {
        if (process.platform === 'win32') {
          // taskkill reaches the whole tree; a plain kill would orphan children.
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        } else if (child.pid) {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        ok: false, code: null, signal: null,
        stdout, stderr: `${stderr}\n${error.message}`, truncated, timedOut,
        durationMs: Date.now() - started, command: display,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        code,
        signal,
        stdout,
        stderr,
        truncated,
        timedOut,
        durationMs: Date.now() - started,
        command: display,
      });
    });
  });
}