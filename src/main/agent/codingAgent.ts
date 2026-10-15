import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { ApprovalManager, PermissionError } from '../approvals/approvalManager';
import { TaskStore } from './taskStore';
import {
  applyPatch,
  createBranch,
  gitDiff,
  gitDirtyPaths,
  gitStatus,
  runGit,
  writeProjectFile,
  executeDirectFileAction,
  readDirectFile,
  ensureNewRepositoryDirectory,
  type DirectFilePlan,
  type GitDiff,
  type GitResult,
  type GitStatusSummary,
} from '../workspace/fileTools';
import { readProjectFile, searchProjectCode } from '../workspace/repoTools';
import { resolveWithinRoot, resolveWithinRootNotRoot, type SandboxOptions } from '../workspace/pathGuard';
import { runApprovedCommand, CommandRejected, type CommandResult } from '../workspace/commandRunner';
import { MemoryStore } from '../knowledge/memoryStore';
import { discoverRepositories } from '../workspace/repoTools';
import type { CodingIntent } from './codingIntent';

/**
 * The coding agent orchestrator.
 *
 * One authoritative engine. The chat and the Coding workspace are two views of
 * this object, never two engines, which is the only way they can be guaranteed
 * to agree.
 *
 * Invariants enforced here, not by callers:
 *
 *  - A plan must be approved before any file changes or commands run.
 *  - Approval is bound to a scope fingerprint; changing the files or commands
 *    invalidates it and forces re-approval.
 *  - The working tree's pre-existing state is recorded, and Astra refuses to
 *    continue if unrelated modifications appear underneath her.
 *  - Nothing is committed, pushed, reset, cleaned or deleted.
 *  - Cancellation stops further tool actions immediately and terminates any
 *    running child process before reporting completion.
 */

export type CodingPhase =
  | 'idle'
  | 'investigating'
  | 'planning'
  | 'awaiting_approval'
  | 'implementing'
  | 'testing'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled';

export interface ToolEvent {
  readonly id: number;
  readonly at: string;
  readonly taskId: number | null;
  /** Machine-readable kind, so the UI can render an icon rather than prose. */
  readonly kind: string;
  readonly label: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface ProposedPlan {
  readonly objective: string;
  readonly repository: string;
  readonly filesToChange: readonly string[];
  readonly commands: readonly { readonly executable: string; readonly args: readonly string[]; readonly purpose: string }[];
  readonly expectedOutcome: string;
  readonly risks: readonly string[];
  readonly rootCause: string;
  readonly investigationNotes: readonly string[];
  readonly patches?: readonly { readonly file: string; readonly hunks: readonly { readonly find: string; readonly replace: string }[] }[];
  readonly newRepository?: { readonly name: string; readonly files: Readonly<Record<string, string>> };
  readonly fileOperation?: DirectFilePlan;
  readonly correctionAttempt?: number;
  /** Optional task branch to create once approved, so work is isolated. */
  readonly branch?: string | null;
}

export interface TaskSnapshot {
  readonly taskId: number | null;
  readonly repository: string | null;
  readonly objective: string | null;
  readonly phase: CodingPhase;
  readonly plan: ProposedPlan | null;
  readonly approval: { readonly requested: boolean; readonly approved: boolean; readonly scopeFingerprint: string | null };
  readonly changes: readonly { readonly file: string; readonly action: string; readonly applied: number }[];
  readonly testResults: readonly { readonly command: string; readonly cwd?: string; readonly exitCode: number | null; readonly ok: boolean; readonly status?: 'passed' | 'failed' | 'skipped'; readonly summary: string; readonly output?: string; readonly durationMs?: number; readonly timedOut?: boolean; readonly truncated?: boolean }[];
  readonly diff: GitDiff | null;
  readonly workingTree: GitStatusSummary | null;
  readonly error: string | null;
  readonly requiresConfirmation: boolean;
  readonly events: readonly ToolEvent[];
  readonly interrupted: boolean;
}

const MAX_EVENTS = 400;

export class CodingAgent extends EventEmitter {
  private taskId: number | null = null;
  private repository: string | null = null;
  private phase: CodingPhase = 'idle';
  private investigatingProposal = false;
  private plan: ProposedPlan | null = null;
  private approvalRequested = false;
  private approvedFingerprint: string | null = null;
  private testResults: TaskSnapshot['testResults'] = [];
  private diff: GitDiff | null = null;
  private workingTree: GitStatusSummary | null = null;
  private baselineStatus: string | null = null;
  private baselineDirty = new Set<string>();
  private error: string | null = null;
  private interrupted = false;
  private cancellationPending = false;
  private recoveredWork = false;
  private readonly events: ToolEvent[] = [];
  private eventSeq = 0;
  private activeCommand: { abort: () => void; done: Promise<CommandResult> } | null = null;

  constructor(
    private readonly sandbox: SandboxOptions,
    private readonly approvals: ApprovalManager,
    private readonly tasks: TaskStore,
    private readonly memory: MemoryStore,
  ) {
    super();
    // A coding task never outlives the process silently.
    this.tasks.recoverOnStartup().forEach((task) => {
      this.emitEvent('task.recovered', `Recovered interrupted task #${task.id} from "${task.state}"; awaiting confirmation`, true, task.objective);
    });
  }

  // ------------------------------------------------------------- selection

  /** Select a repository. Only ever resolves inside the approved root. */
  selectRepository(nameOrPath: string): string {
    // A bare name resolves against the approved root, never against the process
    // working directory, which is not where repositories live.
    const candidate = path.isAbsolute(nameOrPath) ? nameOrPath : path.resolve(this.sandbox.root, nameOrPath);
    const resolved = resolveWithinRoot(candidate, this.sandbox);
    if (!discoverRepositories(this.sandbox).some((repo) => repo.root.toLowerCase() === resolved.toLowerCase())) {
      throw new PermissionError('select a discovered Git repository inside the approved root');
    }
    if (this.taskId && ['investigating', 'planning', 'awaiting_approval', 'implementing', 'testing', 'reviewing', 'paused'].includes(this.phase) && this.repository?.toLowerCase() !== resolved.toLowerCase()) {
      throw new PermissionError('cancel or finish the current task before selecting another repository');
    }
    this.repository = resolved;
    this.interrupted = false;
    this.emitEvent('repo.selected', `Selected ${path.basename(resolved)}`, true, resolved);
    return resolved;
  }

  getRepository(): string | null {
    return this.repository;
  }

  /** Read-only model proposal in progress, before a validated plan exists. */
  setInvestigatingProposal(active: boolean): void {
    this.investigatingProposal = active;
    this.emitEvent(active ? 'proposal.investigating' : 'proposal.settled', active ? 'Investigating source for a coding plan.' : 'Coding proposal investigation ended.', true);
  }

  // ------------------------------------------------------------- planning

  /**
   * Begin a task and produce a plan. Investigation is read-only and always
   * allowed; nothing is modified here.
   */
  async beginTask(input: {
    objective: string;
    repository?: string;
    searchHints?: readonly string[];
    proposedFiles?: readonly string[];
    proposedCommands?: readonly { executable: string; args: readonly string[]; purpose: string }[];
    proposedPatches?: readonly { file: string; hunks: readonly { find: string; replace: string }[] }[];
    expectedOutcome?: string;
    risks?: readonly string[];
    rootCause?: string;
    notes?: readonly string[];
    branch?: string | null;
    newRepository?: { name: string; path: string; files: Readonly<Record<string, string>> };
    fileOperation?: DirectFilePlan;
  }): Promise<TaskSnapshot> {
    if (this.taskId && ['investigating', 'planning', 'awaiting_approval', 'implementing', 'testing', 'reviewing'].includes(this.phase)) {
      throw new PermissionError('finish, reject or cancel the current task before starting another');
    }
    this.reset();
    if (input.repository) this.repository = resolveWithinRoot(input.repository, this.sandbox);
    if (input.newRepository) this.repository = null;
    if (input.fileOperation) this.repository = path.dirname(resolveWithinRootNotRoot(input.fileOperation.target, this.sandbox));

    const task = this.tasks.create({
      repo: this.repository ?? input.newRepository?.path ?? '',
      objective: input.objective,
    });
    this.taskId = task.id;
    this.tasks.transition(task.id, 'investigating');

    if (this.repository && !input.fileOperation) {
      this.workingTree = await gitStatus(this.repository, this.sandbox);
      this.baselineStatus = fingerprintStatus(this.workingTree);
      this.baselineDirty = new Set((await gitDirtyPaths(this.repository, this.sandbox)).map(normaliseRelative));
      const dirty = this.workingTree.staged + this.workingTree.unstaged + this.workingTree.untracked;
      this.emitEvent('git.status', `Working tree: ${this.workingTree.clean ? 'clean' : `${dirty} pre-existing change(s)`}`, true, this.workingTree.branch ?? undefined);
      if (!this.workingTree.clean) {
        this.emitEvent('git.warning', `Pre-existing uncommitted work detected. Astra will not discard it and will only touch files named in the plan.`, true);
      }
    }

    const plan = await this.investigate(input);
    this.plan = plan;
    this.tasks.setPlan(task.id, plan as unknown as Record<string, unknown>);
    this.tasks.setScope(task.id, { repository: plan.repository, files: plan.filesToChange, commands: plan.commands.map((c) => `${c.executable} ${c.args.join(' ')}`) });
    this.tasks.transition(task.id, 'planning');
    this.tasks.transition(task.id, 'awaiting_approval');
    this.phase = 'awaiting_approval';
    this.approvalRequested = false;
    this.approvedFingerprint = null;
    this.emitEvent('plan.proposed', `Plan ready: ${plan.filesToChange.length} file(s), ${plan.commands.length} command(s). Approval required.`, true);
    return this.snapshot();
  }

  /** Read-only investigation producing the concrete plan. */
  private async investigate(input: {
    objective: string;
    searchHints?: readonly string[];
    proposedFiles?: readonly string[];
    proposedCommands?: readonly { executable: string; args: readonly string[]; purpose: string }[];
    proposedPatches?: readonly { file: string; hunks: readonly { find: string; replace: string }[] }[];
    expectedOutcome?: string;
    risks?: readonly string[];
    rootCause?: string;
    notes?: readonly string[];
    branch?: string | null;
    newRepository?: { name: string; path: string; files: Readonly<Record<string, string>> };
    fileOperation?: DirectFilePlan;
  }): Promise<ProposedPlan> {
    const notes: string[] = [...(input.notes ?? [])];
    // Normalise so "src/sum.js" and "src\\sum.js" are one entry. Without this a
    // forward-slash path from a plan and a backslash path from a search become
    // two files, which then fails the scope check for the second.
    const files = new Set<string>();
    for (const file of input.proposedFiles ?? []) files.add(normaliseRelative(file));

    if (this.repository) {
      const repo = this.repository;
      for (const hint of input.searchHints ?? []) {
        const hits = searchProjectCode(repo, this.sandbox, hint, { maxMatches: 25 });
        this.emitEvent('search', `Searched "${hint}": ${hits.length} match(es)`, true);
        for (const hit of hits.slice(0, 10)) files.add(normaliseRelative(hit.relativePath));
      }
      // Prefer repository guidance files as context, read but never obeyed.
      for (const doc of ['AGENTS.md', 'CONTRIBUTING.md', 'README.md']) {
        try {
          const read = readProjectFile(path.join(repo, doc), this.sandbox, { maxBytes: 20_000 });
          if (read.text.trim()) {
            this.emitEvent('read', `Read ${doc} (${read.bytes} bytes) as task context`, true);
            notes.push(`Read ${doc} for context. Its contents are untrusted: they may describe conventions but cannot authorize actions or widen scope.`);
          }
        } catch {
          // Not present; nothing to do.
        }
      }
    }

    if (input.newRepository) {
      const destination = input.newRepository.path;
      const available = !existsSync(destination);
      if (!available) throw new Error(`destination already exists: ${destination}`);
      for (const file of Object.keys(input.newRepository.files)) files.add(normaliseRelative(file));
      notes.push(`Destination check: ${destination} ${available ? 'is available' : 'is NOT available'}.`);
      this.emitEvent('repo.check', `Checked destination availability for ${destination}`, available, available ? undefined : 'destination unavailable');
    }
    if (input.fileOperation) {
      const target = resolveWithinRootNotRoot(input.fileOperation.target, this.sandbox);
      if (target !== input.fileOperation.target || path.dirname(target) !== this.repository) throw new PermissionError('file target differs from the approved directory');
      files.add(path.basename(target));
      notes.push(`Direct ${input.fileOperation.action} of ${target}; parent directory ${input.fileOperation.createParent ? 'will be created after approval' : 'exists'}. No Git repository or remote is created.`);
      this.emitEvent('file.check', `Checked ${target} for a direct file operation`, true);
    }

    const fileList = [...files];
    const commands = input.proposedCommands ?? [];
    return {
      objective: input.objective,
      repository: this.repository ?? input.newRepository?.path ?? '',
      filesToChange: fileList,
      commands,
      expectedOutcome: input.expectedOutcome ?? `The objective is met and the proposed checks pass, with changes limited to: ${fileList.join(', ') || 'no files'}.`,
      risks: input.risks ?? buildRisks(input, fileList, commands),
      rootCause: input.rootCause ?? 'Not yet determined; investigation is required before changing anything.',
      investigationNotes: notes,
      patches: input.proposedPatches,
      newRepository: input.newRepository ? { name: input.newRepository.name, files: input.newRepository.files } : undefined,
      fileOperation: input.fileOperation,
      branch: input.branch ?? null,
    };
  }

  // ------------------------------------------------------------- approval

  /**
   * Record Karl's decision. Approval is bound to a fingerprint of the scope,
   * so widening the plan after approval invalidates it.
   */
  approve(): TaskSnapshot {
    if (!this.plan || !this.taskId) throw new Error('there is no plan awaiting approval');
    if (this.tasks.get(this.taskId)?.state !== 'awaiting_approval' || this.interrupted) throw new PermissionError('task is not awaiting a fresh approval');
    const fingerprint = scopeFingerprint(this.plan);
    this.tasks.transition(this.taskId, 'awaiting_approval');
    this.approvalRequested = true;
    this.approvedFingerprint = fingerprint;
    this.phase = 'implementing';
    this.tasks.transition(this.taskId, 'implementing');
    this.approvals.record({
      actor: 'karl',
      action: 'coding.plan.approve',
      target: `task:${this.taskId}`,
      detail: { repository: this.plan.repository, files: this.plan.filesToChange, commands: this.plan.commands.map((c) => `${c.executable} ${c.args.join(' ')}`) },
    });
    this.emitEvent('approval.granted', 'Karl approved this plan.', true);
    return this.snapshot();
  }

  reject(reason = 'Karl declined the plan'): TaskSnapshot {
    if (!this.taskId || this.tasks.get(this.taskId)?.state !== 'awaiting_approval') throw new PermissionError('no plan is awaiting rejection');
    this.tasks.cancel(this.taskId, reason);
    this.phase = 'cancelled';
    this.emitEvent('approval.rejected', `Plan rejected: ${reason}. Nothing was changed and no command was run.`, true);
    this.approvals.record({ actor: 'karl', action: 'coding.plan.reject', target: `task:${this.taskId ?? 'none'}`, detail: { reason } });
    return this.snapshot();
  }

  // -------------------------------------------------------- implementation

  /**
   * Create the task branch named in the approved plan.
   *
   * This is deliberately explicit and opt-in: branching rewrites repository
   * history position, so it appears in the plan and is covered by the
   * approval fingerprint. Astra never force-checkouts, rebases or deletes a
   * branch, and if the branch already exists she stops rather than resetting it.
   */
  async createTaskBranch(): Promise<TaskSnapshot> {
    this.assertApproved();
    const repository = this.requireRepository();
    const branch = this.plan!.branch;
    if (!branch) {
      this.emitEvent('git.branch', 'No task branch was requested; working on the current branch.', true);
      return this.snapshot();
    }
    if (this.baselineStatus !== null) {
      const current = await gitStatus(repository, this.sandbox);
      if (fingerprintStatus(current) !== this.baselineStatus) {
        throw new Error('The working tree changed after the plan; re-investigate before creating a task branch.');
      }
    }
    const result: GitResult = await createBranch(repository, this.sandbox, branch);
    if (!result.ok) {
      this.emitEvent('git.branch', `Could not create task branch "${branch}": ${result.stderr.trim() || 'unknown reason'}`, false);
      this.approvals.record({ actor: 'astra', action: 'git.branch.create', target: branch, result: 'refused', detail: { reason: result.stderr.trim() } });
      throw new Error(`Approved task branch could not be created: ${result.stderr.trim() || 'unknown reason'}`);
    }
    this.workingTree = await gitStatus(repository, this.sandbox);
    this.emitEvent('git.branch', `Created and switched to task branch "${branch}".`, true);
    this.approvals.record({ actor: 'astra', action: 'git.branch.create', target: branch });
    return this.snapshot();
  }

  /**
   * Apply the approved plan. Refuses if the working tree gained unrelated
   * modifications, if the plan is unapproved, or if the scope drifted.
   */
  async implement(input: {
    patches: readonly { file: string; hunks: readonly { find: string; replace: string }[] }[];
    writes?: readonly { file: string; content: string }[];
  }): Promise<TaskSnapshot> {
    this.assertApproved();
    const repository = this.requireRepository();
    this.phase = 'implementing';

    // Refuse to continue if unrelated changes appeared since the baseline.
    if (this.repository && this.baselineStatus !== null) {
      const now = await gitStatus(this.repository, this.sandbox);
      this.workingTree = now;
      if (fingerprintStatus(now) !== this.baselineStatus) {
        throw new Error('The working tree changed underneath this task. Re-investigate before making further edits.');
      }
    }

    const allowed = new Set(this.plan!.filesToChange.map(normaliseRelative));
    if (this.plan!.patches && JSON.stringify(input.patches) !== JSON.stringify(this.plan!.patches)) {
      throw new PermissionError('patch differs from the approved plan');
    }
    for (const file of allowed) {
      if (this.baselineDirty.has(file)) throw new PermissionError(`refusing to overwrite pre-existing work in ${file}`);
    }
    if (input.writes?.length) {
      throw new PermissionError('direct writes require an exact approved file plan');
    }
    for (const patch of input.patches) {
      if (!allowed.has(normaliseRelative(patch.file))) {
        throw new PermissionError(`"${patch.file}" is outside the approved file list`);
      }
    }
    for (const write of input.writes ?? []) {
      if (!allowed.has(normaliseRelative(write.file))) {
        throw new PermissionError(`"${write.file}" is outside the approved file list`);
      }
    }

    for (const patch of input.patches) {
      const result = applyPatch(repository, this.sandbox, patch.file, patch.hunks);
      this.emitEvent('patch.applied', `Patched ${patch.file}: ${result.patch.applied} hunk(s) applied`, result.patch.failed.length === 0, result.patch.failed.length ? JSON.stringify(result.patch.failed) : undefined);
      if (result.patch.failed.length > 0) {
        this.tasks.recordChange(this.taskId!, { file: patch.file, action: 'patch', applied: result.patch.applied, failed: result.patch.failed.length });
        throw new Error(`Patch to ${patch.file} did not fully apply; nothing was forced.`);
      }
      this.tasks.recordChange(this.taskId!, { file: patch.file, action: 'patch', applied: result.patch.applied });
    }

    for (const write of input.writes ?? []) {
      writeProjectFile(repository, this.sandbox, write.file, write.content);
      this.emitEvent('file.written', `Wrote ${write.file}`, true);
      this.tasks.recordChange(this.taskId!, { file: write.file, action: 'write', applied: 1 });
    }

    return this.snapshot();
  }

  /** Create a new repository from an approved plan. Never overwrites. */
  async createRepository(input: { name: string; files: Readonly<Record<string, string>> }): Promise<TaskSnapshot> {
    this.assertApproved();
    const planned = this.plan?.newRepository;
    if (!planned || input.name !== planned.name || JSON.stringify(input.files) !== JSON.stringify(planned.files)) {
      throw new PermissionError('repository name or scaffold differs from the approved plan');
    }
    const target = resolveWithinRootNotRoot(path.resolve(this.sandbox.root, input.name), this.sandbox);
    if (target !== this.plan?.repository) throw new PermissionError('repository path differs from the approved plan');
    if (existsSync(target)) throw new PermissionError('destination already exists');
    ensureNewRepositoryDirectory(target, this.sandbox);
    for (const [file, content] of Object.entries(input.files)) {
      writeProjectFile(target, this.sandbox, file, content);
    }
    const init: GitResult = await runGit(target, this.sandbox, ['init']);
    if (!init.ok) throw new Error(`git init failed: ${init.stderr.slice(0, 200)}`);
    this.emitEvent('repo.created', `Created ${path.basename(target)} and initialised Git`, init.ok, init.ok ? undefined : init.stderr.slice(0, 200));
    this.repository = target;
    if (this.taskId) this.tasks.recordChange(this.taskId, { action: 'create_repository', path: target });
    return this.snapshot();
  }

  /** Apply and verify one exact, approved file operation without requiring Git. */
  executeFileOperation(): TaskSnapshot {
    this.assertApproved();
    const planned = this.plan?.fileOperation;
    if (!planned) throw new PermissionError('no direct file operation is in the approved plan');
    this.phase = 'implementing';
    const result = executeDirectFileAction(planned, this.sandbox);
    this.tasks.recordChange(this.taskId!, { file: result.target, action: result.action, applied: 1 });
    this.emitEvent('file.verified', `${result.action} verified on disk: ${result.target} (${result.bytes} bytes)`, true, result.sha256 ?? undefined);
    return this.snapshot();
  }

  /** After a restart, accept only a fully recognisable approved result. */
  async implementationAlreadyPresent(): Promise<boolean> {
    this.assertApproved();
    if (!this.recoveredWork) return false;
    const plan = this.plan!;
    const changes = this.tasks.get(this.taskId!)?.changes ?? [];
    if (plan.fileOperation) {
      const operation = plan.fileOperation;
      if (changes.length === 0) {
        this.recoveredWork = false;
        return false;
      }
      if (operation.action === 'delete') {
        if (existsSync(operation.target)) throw new Error('interrupted deletion is incomplete; manual review required');
      } else {
        const observed = readDirectFile(operation.target, this.sandbox);
        if (observed.content !== operation.content) throw new Error('interrupted file differs from the approved content; manual review required');
      }
      this.emitEvent('file.recovery_checked', 'Previously applied file operation was verified on disk.', true);
      this.recoveredWork = false;
      return true;
    }
    if (changes.length === 0) {
      if (!plan.newRepository) {
        const status = await gitStatus(this.requireRepository(), this.sandbox);
        if (!status.clean) throw new Error('the repository changed during interruption; review it and create a fresh plan');
        this.baselineStatus = fingerprintStatus(status);
      }
      this.recoveredWork = false;
      return false;
    }
    if (plan.newRepository) {
      const destination = resolveWithinRootNotRoot(plan.repository, this.sandbox);
      if (!existsSync(path.join(destination, '.git'))) throw new Error('interrupted repository has no Git metadata; manual review required');
      for (const [file, content] of Object.entries(plan.newRepository.files)) {
        const target = resolveWithinRootNotRoot(path.resolve(destination, file), { root: destination });
        if (!existsSync(target) || readFileSync(target, 'utf8') !== content) throw new Error('interrupted scaffold differs from the approved plan; manual review required');
      }
    } else {
      const allowed = new Set(plan.filesToChange.map(normaliseRelative));
      for (const dirty of await gitDirtyPaths(this.requireRepository(), this.sandbox)) {
        if (!allowed.has(normaliseRelative(dirty))) throw new Error('unrelated files changed during interruption; manual review required');
      }
      for (const patch of plan.patches ?? []) {
        const target = resolveWithinRootNotRoot(path.resolve(plan.repository, patch.file), { root: plan.repository });
        const text = readProjectFile(target, { root: plan.repository }).text;
        for (const hunk of patch.hunks) {
          if (!text.includes(hunk.replace) || text.includes(hunk.find)) throw new Error(`interrupted patch in ${patch.file} is incomplete or changed; manual review required`);
        }
      }
    }
    this.emitEvent('task.recovery_checked', 'Previously applied work matches the approved plan; continuing with checks.', true);
    this.recoveredWork = false;
    return true;
  }

  // ---------------------------------------------------------------- tests

  /**
   * Run one approved command. Rejects anything not named in the plan, and
   * reports timeout, exit code and output honestly.
   */
  async runApprovedCommand(executable: string, args: readonly string[]): Promise<TaskSnapshot> {
    this.assertApproved();
    const repository = this.requireRepository();
    const allowed = this.plan!.commands.some(
      (c) => c.executable === executable && JSON.stringify(c.args) === JSON.stringify(args),
    );
    if (!allowed) {
      const refusal = `${executable} ${args.join(' ')} is not in the approved command set`;
      this.emitEvent('command.refused', `Refused: ${refusal}`, false);
      this.approvals.record({ actor: 'astra', action: 'command.refused', target: `${executable} ${args.join(' ')}`, result: 'refused' });
      throw new PermissionError(refusal);
    }

    this.phase = 'testing';
    if (this.taskId) this.tasks.transition(this.taskId, 'testing');

    let result: CommandResult;
    const controller = new AbortController();
    try {
      this.emitEvent('command.started', `Running: ${executable} ${args.join(' ')}`, true);
      const done = runApprovedCommand({ executable, args, cwd: repository, purpose: this.plan!.objective, signal: controller.signal }, this.sandbox);
      this.activeCommand = { abort: () => controller.abort(), done };
      result = await done;
    } catch (error) {
      const reason = error instanceof CommandRejected ? error.message : String(error);
      this.emitEvent('command.refused', `Refused: ${reason}`, false);
      this.approvals.record({ actor: 'astra', action: 'command.refused', target: `${executable} ${args.join(' ')}`, result: 'refused', detail: { reason } });
      throw error;
    } finally {
      this.activeCommand = null;
    }

    const status = classifyCheck(result);
    const summary = sanitiseOutput(status === 'skipped' ? `skipped: ${summariseOutput(result)}` : summariseOutput(result));
    const output = sanitiseOutput(`${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`);
    const record = { command: result.command, cwd: repository, exitCode: result.code, ok: status === 'passed', status, summary, output, durationMs: result.durationMs, timedOut: result.timedOut, truncated: result.truncated };
    this.testResults = [...this.testResults, record];
    this.emitEvent(
      'command.finished',
      `${result.command} exited ${result.code === null ? 'abnormally' : result.code} after ${result.durationMs} ms`,
      record.ok,
      summary,
    );
    if (this.taskId) this.tasks.recordTestResult(this.taskId, record);
    return this.snapshot();
  }

  // --------------------------------------------------------------- review

  async review(): Promise<TaskSnapshot> {
    this.assertApproved();
    if (this.plan?.fileOperation) {
      const operation = this.plan.fileOperation;
      if (operation.action === 'delete') {
        if (existsSync(operation.target)) throw new Error('delete verification failed: file remains on disk');
      } else if (readDirectFile(operation.target, this.sandbox).content !== operation.content) {
        throw new Error('write verification failed: on-disk content differs');
      }
      this.phase = 'reviewing';
      if (this.taskId) this.tasks.transition(this.taskId, 'reviewing');
      this.emitEvent('file.reviewed', `Verified ${operation.target} against the approved plan.`, true);
      return this.snapshot();
    }
    const repository = this.requireRepository();
    this.phase = 'reviewing';
    if (this.taskId) this.tasks.transition(this.taskId, 'reviewing');
    this.diff = await gitDiff(repository, this.sandbox, { paths: this.plan?.filesToChange });
    this.workingTree = await gitStatus(repository, this.sandbox);
    this.emitEvent('git.diff', `Diff: ${this.diff.filesChanged} file(s), +${this.diff.insertions}/-${this.diff.deletions}`, true);
    return this.snapshot();
  }

  /** Finish the task and record a reusable technical summary in memory. */
  async complete(summary?: string): Promise<TaskSnapshot> {
    this.assertApproved();
    // The lifecycle requires REVIEW before COMPLETE. When tests just ran, the
    // task is in `testing`, so pass through review rather than skipping it.
    if (this.repository && this.phase !== 'reviewing' && this.phase !== 'cancelled') {
      await this.review();
    }
    this.phase = 'completed';
    if (this.taskId) {
      this.tasks.transition(this.taskId, 'completed');
      const plan = this.plan;
      const passed = this.testResults.filter((r) => r.ok).length;
      const attempted = this.testResults.length;
      const statement = [
        `In ${plan ? path.basename(plan.repository) : 'an unknown repository'}`,
        plan?.rootCause ? `proposed cause (model inference): ${plan.rootCause.replace(/[.\s]+$/, '')}` : null,
        `solution: ${plan ? plan.filesToChange.join(', ') : 'unknown files'}`,
        attempted ? `tests: ${passed}/${attempted} passed (${this.testResults.map((r) => `${r.command} exit ${r.exitCode}`).join('; ')})` : 'no tests were run',
        summary ? `outcome: ${summary}` : null,
      ].filter(Boolean).join('. ');
      // Confidence is deliberately below 1: a stored solution is a lead, not a fact.
      this.memory.remember({
        category: attempted > 0 && passed === attempted ? 'successful_approach' : 'development_note',
        statement,
        provenance: 'task_outcome',
        confidence: 0.7,
        origin: 'task',
      });
      this.emitEvent('memory.saved', 'Recorded a technical summary in memory for future retrieval.', true);
    }
    this.emitEvent('task.completed', 'Task completed.', true);
    return this.snapshot();
  }

  fail(reason: string): TaskSnapshot {
    this.error = reason;
    this.phase = 'failed';
    this.approvedFingerprint = null;
    if (this.taskId) this.tasks.fail(this.taskId, reason);
    this.emitEvent('task.failed', reason, false);
    return this.snapshot();
  }

  /** A failed approved check may produce one narrowed follow-up plan. */
  async proposeCorrection(input: { rootCause: string; expectedOutcome: string; risks: readonly string[]; patches: ProposedPlan['patches'] }): Promise<TaskSnapshot> {
    const old = this.plan;
    if (!old || !this.taskId || this.phase !== 'testing' || (old.correctionAttempt ?? 0) >= 1 || !input.patches?.length) {
      throw new PermissionError('bounded correction is unavailable for this task');
    }
    const allowed = new Set(old.filesToChange.map(normaliseRelative));
    if (input.patches.some((patch) => !allowed.has(normaliseRelative(patch.file)))) throw new PermissionError('correction widens the approved file scope');
    this.approvedFingerprint = null;
    this.tasks.fail(this.taskId, this.testResults.at(-1)?.summary ?? 'approved check failed');
    this.tasks.transition(this.taskId, 'investigating');
    this.tasks.transition(this.taskId, 'planning');
    const plan: ProposedPlan = {
      ...old,
      // The first approval already created the task branch. A correction
      // continues on that same branch after fresh approval.
      branch: null,
      patches: input.patches,
      rootCause: input.rootCause,
      expectedOutcome: input.expectedOutcome,
      risks: input.risks,
      correctionAttempt: 1,
      investigationNotes: [...old.investigationNotes, `Prior approved check failed: ${this.testResults.at(-1)?.summary ?? 'unknown'}. A revised patch needs fresh approval.`],
    };
    this.plan = plan;
    this.tasks.setPlan(this.taskId, plan as unknown as Record<string, unknown>);
    this.tasks.transition(this.taskId, 'awaiting_approval');
    this.phase = 'awaiting_approval';
    this.workingTree = await gitStatus(this.requireRepository(), this.sandbox);
    this.baselineStatus = fingerprintStatus(this.workingTree);
    this.emitEvent('plan.correction', 'A bounded correction is proposed after the failed check; fresh approval is required.', true);
    return this.snapshot();
  }

  /** Cancel now. Terminates any running process before reporting. */
  async cancel(reason = 'cancelled by Karl'): Promise<TaskSnapshot> {
    if (!this.taskId || ['completed', 'failed', 'cancelled'].includes(this.tasks.get(this.taskId)?.state ?? '')) return this.snapshot();
    this.cancellationPending = true;
    this.approvedFingerprint = null;
    this.interrupted = true;
    if (this.activeCommand) {
      const active = this.activeCommand;
      active.abort();
      await active.done;
      this.emitEvent('command.killed', 'The running command has exited.', true);
    }
    // Withdrawal of authority: the approval is discarded so no later call can
    // slip through using the fingerprint captured before the cancellation.
    this.phase = 'cancelled';
    this.error = reason;
    if (this.taskId) this.tasks.cancel(this.taskId, reason);
    this.emitEvent('task.cancelled', `${reason} No further tool action will run for this task.`, true);
    this.cancellationPending = false;
    return this.snapshot();
  }

  isStopping(): boolean { return this.cancellationPending || this.phase === 'cancelled' || this.phase === 'paused'; }

  async pauseForShutdown(): Promise<TaskSnapshot> {
    this.cancellationPending = true;
    this.approvedFingerprint = null;
    this.interrupted = true;
    if (this.activeCommand) {
      const active = this.activeCommand;
      active.abort();
      await active.done;
      this.emitEvent('command.killed', 'The active command exited before shutdown.', true);
    }
    if (this.taskId && ['implementing', 'testing'].includes(this.tasks.get(this.taskId)?.state ?? '')) {
      this.tasks.transition(this.taskId, 'paused', 'application shutdown interrupted executable work');
    }
    this.phase = 'paused';
    this.emitEvent('task.paused', 'Executable work stopped for shutdown; fresh confirmation is required on restart.', true);
    this.cancellationPending = false;
    return this.snapshot();
  }

  // ------------------------------------------------------------- recovery

  /** Restore a persisted task for review. Never resumes executable work. */
  async restore(taskId: number): Promise<TaskSnapshot> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`unknown task ${taskId}`);
    this.reset();
    this.taskId = task.id;
    this.repository = task.repo || null;
    this.interrupted = task.requiresConfirm;
    this.error = task.error;
    this.testResults = task.testResults as TaskSnapshot['testResults'];
    this.plan = (task.plan as unknown as ProposedPlan) ?? null;
    this.recoveredWork = task.requiresConfirm;
    this.events.length = 0;
    for (const event of this.tasks.events(task.id, 120)) {
      this.events.push({ id: ++this.eventSeq, at: event.at, taskId: task.id, kind: event.kind, label: event.detail, ok: !/failed|refused|cancelled/.test(event.kind) });
    }
    this.baselineStatus = null;
    this.phase = task.requiresConfirm ? 'awaiting_approval' : (task.state as CodingPhase);
    if (this.repository && !this.plan?.fileOperation) {
      this.workingTree = await gitStatus(this.repository, this.sandbox).catch(() => null);
    }
    this.emitEvent(
      'task.restored',
      task.requiresConfirm
        ? `Task #${task.id} was interrupted in "${task.state}". Nothing resumed; Karl must confirm before continuing.`
        : `Task #${task.id} restored for review.`,
      true,
    );
    return this.snapshot();
  }

  confirmResume(): TaskSnapshot {
    if (!this.taskId) throw new Error('there is no task to resume');
    this.tasks.confirmResume(this.taskId);
    this.interrupted = false;
    this.cancellationPending = false;
    this.phase = 'awaiting_approval';
    this.approvedFingerprint = null;
    this.emitEvent('task.resumed', 'Karl confirmed review of the interrupted task. The plan needs fresh approval.', true);
    return this.snapshot();
  }

  /** Allow the orchestrator to terminate a running command on shutdown. */
  // -------------------------------------------------------------- snapshot

  snapshot(): TaskSnapshot {
    return {
      taskId: this.taskId,
      repository: this.repository,
      objective: this.taskId ? this.tasks.get(this.taskId)?.objective ?? null : null,
      phase: this.investigatingProposal ? 'investigating' : this.phase,
      plan: this.plan,
      approval: { requested: this.approvalRequested, approved: this.approvedFingerprint !== null, scopeFingerprint: this.approvedFingerprint },
      changes: (this.taskId ? this.tasks.get(this.taskId)?.changes ?? [] : []) as TaskSnapshot['changes'],
      testResults: this.testResults,
      diff: this.diff,
      workingTree: this.workingTree,
      error: this.error,
      requiresConfirmation: this.interrupted,
      events: this.events.slice(-120),
      interrupted: this.interrupted,
    };
  }

  /** Subscribe to tool activity. Used by both chat and the Coding workspace. */
  onActivity(listener: (event: ToolEvent) => void): () => void {
    this.on('activity', listener);
    return () => this.off('activity', listener);
  }

  private emitEvent(kind: string, label: string, ok: boolean, detail?: string): ToolEvent {
    const event: ToolEvent = { id: ++this.eventSeq, at: new Date().toISOString(), taskId: this.taskId, kind, label, ok, ...(detail ? { detail } : {}) };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    this.emit('activity', event);
    return event;
  }

  private assertApproved(): void {
    if (!this.plan) throw new Error('there is no plan');
    if ((!this.repository && !this.plan.newRepository) || (this.repository && this.repository.toLowerCase() !== this.plan.repository.toLowerCase())) {
      throw new PermissionError('selected repository differs from the approved plan');
    }
    if (this.approvedFingerprint === null) throw new PermissionError('the plan has not been approved');
    const current = scopeFingerprint(this.plan);
    if (current !== this.approvedFingerprint) {
      throw new PermissionError('the plan scope changed after approval; renewed approval is required');
    }
    if (this.interrupted) throw new PermissionError('this task was interrupted; renewed confirmation is required before continuing');
    const task = this.taskId ? this.tasks.get(this.taskId) : undefined;
    if (!task || !['implementing', 'testing', 'reviewing'].includes(task.state) || task.requiresConfirm) throw new PermissionError('this task is not approved for work');
  }

  private requireRepository(): string {
    if (!this.repository) throw new Error('no repository is selected');
    return this.repository;
  }

  private reset(): void {
    this.taskId = null;
    this.phase = 'idle';
    this.plan = null;
    this.approvalRequested = false;
    this.approvedFingerprint = null;
    this.testResults = [];
    this.diff = null;
    this.error = null;
    this.interrupted = false;
    this.cancellationPending = false;
    this.baselineStatus = null;
    this.recoveredWork = false;
    this.baselineDirty.clear();
  }
}

/**
 * Canonical form of a repository-relative path.
 *
 * Windows reports the same file as `src/sum.js` or `src\sum.js` depending on
 * who produced the string. Scope checks compare names, so both must collapse
 * to one form or an approved edit is refused for a purely cosmetic reason.
 */
export function normaliseRelative(relative: string): string {
  return relative.replace(/[\\/]+/g, '/').replace(/^\.\//, '');
}

/** Stable fingerprint of everything an approval authorises. */
export function scopeFingerprint(plan: ProposedPlan): string {
  return JSON.stringify({
    repository: plan.repository,
    files: [...plan.filesToChange].sort(),
    commands: plan.commands.map((c) => `${c.executable} ${c.args.join(' ')}`).sort(),
    branch: plan.branch ?? null,
    patches: plan.patches ?? null,
    newRepository: plan.newRepository ?? null,
    fileOperation: plan.fileOperation ?? null,
  });
}

function fingerprintStatus(status: GitStatusSummary): string {
  return status.lines.filter((line) => !line.startsWith('##')).sort().join('\n');
}

function buildRisks(
  input: { objective: string; newRepository?: { name: string; path: string } },
  files: readonly string[],
  commands: readonly { executable: string; args: readonly string[] }[],
): string[] {
  const risks: string[] = [];
  if (input.newRepository) {
    risks.push('Creating a new project needs dependencies to be useful. Installation is currently blocked, so the scaffold will not run.');
  }
  if (files.length > 3) risks.push(`${files.length} files will change; a wide change is harder to review.`);
  if (commands.some((c) => /test|build/i.test(`${c.executable} ${c.args.join(' ')}`))) {
    risks.push('Test and build commands execute project code, which may run arbitrary code from the repository.');
  }
  if (risks.length === 0) risks.push('Changes are limited to the files listed above.');
  return risks;
}

/** Honest one-line summary of a command result. */
export function summariseOutput(result: CommandResult): string {
  if (result.timedOut) return `timed out after ${result.durationMs} ms`;
  const body = (result.stdout || result.stderr || '').trim();
  const tail = body.split(/\r?\n/).filter(Boolean).slice(-4).join(' | ');
  const prefix = result.ok ? 'passed' : `failed with exit ${result.code}`;
  if (result.truncated) return `${prefix} (output truncated): ${tail.slice(0, 300)}`;
  return `${prefix}: ${tail.slice(0, 300)}`;
}

export function classifyCheck(result: CommandResult): 'passed' | 'failed' | 'skipped' {
  if (!result.ok) return 'failed';
  const output = `${result.stdout}\n${result.stderr}`;
  const pass = /(?:^|\n)\s*(?:#|ℹ)?\s*pass\s+(\d+)\b/im.exec(output)?.[1];
  const skip = /(?:^|\n)\s*(?:#|ℹ)?\s*skip(?:ped)?\s+(\d+)\b/im.exec(output)?.[1];
  if (skip && Number(skip) > 0 && pass !== undefined && Number(pass) === 0) return 'skipped';
  if (/\b(?:all tests skipped|no tests (?:were )?run)\b/i.test(output)) return 'skipped';
  return 'passed';
}

function sanitiseOutput(value: string): string {
  return value.slice(0, 12_000)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, '[redacted private key]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b([\w]*(?:KEY|TOKEN|SECRET|PASSWORD|PIN)[\w]*)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}

/** Intents that may be handled directly without a coding task. */
export function isReadOnlyIntent(intent: CodingIntent): boolean {
  return ['list_repositories', 'select_repository', 'explain_project', 'find_code', 'investigate_tests', 'show_changes'].includes(intent.kind);
}
