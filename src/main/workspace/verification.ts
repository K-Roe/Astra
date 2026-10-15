import { readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { PathRejected, resolveWithinRootNotRoot, type SandboxOptions } from './pathGuard';

/**
 * Evidence-producing checks for claims about the local machine.
 *
 * Every function here answers from a real syscall or a real socket, never from
 * an assumption. That is the whole point of the module: Astra's failure mode is
 * narrating a repository, a URL or a memory write that never happened, and the
 * only durable defence is that a statement of the form "X exists" may only be
 * made after one of these checks returned.
 *
 * Three rules hold everywhere below:
 *
 *  1. **Absence is reported as absence.** "No" is a complete, honest answer and
 *     is never softened into a guess.
 *  2. **Containment still applies.** Paths go through the same root check as
 *     every other filesystem tool, so verification cannot be used to read
 *     outside `C:\Users\karlr\repos`.
 *  3. **Loopback only.** Astra may probe a service on this machine; it may not
 *     use the local network as an oracle, so only loopback addresses are
 *     accepted and anything else is refused rather than attempted.
 */

export type PathKind = 'directory' | 'file' | 'missing' | 'other';

export interface PathInspection {
  /** Canonical absolute path, as resolved by the containment check. */
  readonly target: string;
  readonly exists: boolean;
  readonly kind: PathKind;
  /** True only when a real `.git` entry is present. Never inferred. */
  readonly isGitRepository: boolean;
  /** Current branch, when Git could report one. */
  readonly branch: string | null;
  /** Immediate entry names, bounded, excluding ignored directories. */
  readonly entries: readonly string[];
  /** Set when the path could not be inspected, with the reason. */
  readonly unavailable: string | null;
}

const MAX_ENTRIES = 40;

/**
 * Inspect a path and report what is actually on disk.
 *
 * A `.git` entry is the only accepted evidence of a Git repository. The mere
 * presence of files, or a name that looks like a repository, proves nothing.
 */
export function inspectPath(candidate: string, sandbox: SandboxOptions, branch: string | null = null): PathInspection {
  let target: string;
  try {
    target = resolveWithinRootNotRoot(candidate, sandbox);
  } catch (error) {
    const reason = error instanceof PathRejected ? error.reason : 'unreadable';
    return {
      target: typeof candidate === 'string' ? candidate : String(candidate),
      exists: false,
      kind: 'missing',
      isGitRepository: false,
      branch: null,
      entries: [],
      unavailable: `Astra will not inspect paths outside the approved root ${sandbox.root} (${reason}).`,
    };
  }

  let stats;
  try {
    stats = statSync(target);
  } catch {
    return { target, exists: false, kind: 'missing', isGitRepository: false, branch: null, entries: [], unavailable: null };
  }

  const kind: PathKind = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other';
  const isGitRepository = kind === 'directory' && hasGitEntry(target);
  const entries: string[] = [];
  if (kind === 'directory' && !isGitRepository) {
    try {
      for (const name of readdirSync(target)) {
        if (name.startsWith('.') || name === 'node_modules') continue;
        entries.push(name);
        if (entries.length >= MAX_ENTRIES) break;
      }
    } catch {
      // An unreadable directory is still a real directory; the listing is
      // simply unavailable, which the caller states rather than hides.
    }
  }
  return { target, exists: true, kind, isGitRepository, branch: isGitRepository ? branch : null, entries, unavailable: null };
}

/**
 * True when the directory holds real Git metadata.
 *
 * A `.git` directory is a normal repository; a `.git` file marks a worktree or
 * submodule. Both are accepted, because both are genuine repositories. A
 * directory with no `.git` entry is reported as not a repository even if it
 * contains files that look like source.
 */
export function hasGitEntry(directory: string): boolean {
  const git = path.join(directory, '.git');
  try {
    const stats = statSync(git);
    return stats.isDirectory() || stats.isFile();
  } catch {
    return false;
  }
}

export interface ServiceInspection {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  /** True only when a TCP connection was actually established. */
  readonly listening: boolean;
  /** Set when the address is not loopback and was therefore refused. */
  readonly unavailable: string | null;
}

/** Hosts Astra is permitted to probe. Anything else is refused, not attempted. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

/**
 * Probe whether something is listening on a loopback port.
 *
 * This opens a real socket and reports what happened. It does not fetch the
 * service, execute anything, or reach off-machine. A refused or timed-out
 * connection is reported as "not listening", which is the honest answer.
 */
export async function inspectLocalService(
  address: string,
  timeoutMs = 2000,
  connect: (options: net.NetConnectOpts, listener: () => void) => net.Socket = (options, listener) => net.connect(options, listener),
): Promise<ServiceInspection> {
  let parsed: URL;
  try {
    parsed = new URL(address.includes('://') ? address : `http://${address}`);
  } catch {
    return { url: address, host: '', port: 0, listening: false, unavailable: `"${address}" is not a usable local address.` };
  }

  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    return {
      url: parsed.toString(),
      host,
      port: Number(parsed.port || 80),
      listening: false,
      unavailable: `Astra only checks services on this machine. ${host} is not a local address, so it was not contacted.`,
    };
  }

  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { url: parsed.toString(), host, port, listening: false, unavailable: `${port} is not a valid port number.` };
  }

  return new Promise<ServiceInspection>((resolve) => {
    let settled = false;
    const finish = (listening: boolean, unavailable: string | null): void => {
      if (settled) return;
      settled = true;
      resolve({ url: parsed.toString(), host, port, listening, unavailable });
    };
    let socket: net.Socket;
    try {
      socket = connect({ host: host === '[::1]' || host === '::1' ? '::1' : host, port }, () => {
        socket.destroy();
        finish(true, null);
      });
    } catch (error) {
      finish(false, `Astra could not open a connection to ${host}:${port}: ${error instanceof Error ? error.message : String(error)}.`);
      return;
    }
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      finish(false, `Nothing answered on ${host}:${port} within ${timeoutMs}ms.`);
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      socket.destroy();
      finish(false, `No service is listening on ${host}:${port} (${error.code ?? error.message}).`);
    });
  });
}