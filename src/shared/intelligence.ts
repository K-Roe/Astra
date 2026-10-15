/**
 * Typed IPC surface for Astra's intelligence features.
 *
 * The renderer is sandboxed with `connect-src 'none'` and has no Node access,
 * so every privileged operation crosses this narrow, explicitly typed bridge.
 * Two rules hold throughout:
 *
 *  - The renderer never sends a filesystem path it wants acted upon blindly.
 *    Repository work names a project id; the main process resolves the real
 *    root from its own record and re-validates containment at use time.
 *  - Approval is enforced in main, immediately before the operation, and is
 *    never inferred from the renderer having asked.
 */

export const INTELLIGENCE_CHANNELS = {
  sources: 'astra:sources',
  sourceAdd: 'astra:source-add',
  sourceLearn: 'astra:source-learn',
  sourceRevoke: 'astra:source-revoke',
  sourceDelete: 'astra:source-delete',
  knowledgeSearch: 'astra:knowledge-search',
  knowledgeStats: 'astra:knowledge-stats',
  memoryList: 'astra:memory-list',
  memoryRemember: 'astra:memory-remember',
  memoryCorrect: 'astra:memory-correct',
  memoryForget: 'astra:memory-forget',
  memoryCorrections: 'astra:memory-corrections',
  projectsList: 'astra:projects-list',
  projectInspect: 'astra:project-inspect',
  projectReadFile: 'astra:project-read-file',
  projectSearch: 'astra:project-search',
  approvalsRequest: 'astra:approvals-request',
  approvalsDecide: 'astra:approvals-decide',
  approvalsList: 'astra:approvals-list',
  auditList: 'astra:audit-list',
  tasksCreate: 'astra:tasks-create',
  tasksList: 'astra:tasks-list',
  tasksTransition: 'astra:tasks-transition',
  tasksCancel: 'astra:tasks-cancel',
  tasksConfirm: 'astra:tasks-confirm',
  tasksEvents: 'astra:tasks-events',
  codingBenchmark: 'astra:coding-benchmark',
  codingSnapshot: 'astra:coding-snapshot',
  codingSelectRepo: 'astra:coding-select-repo',
  codingApprove: 'astra:coding-approve',
  codingReject: 'astra:coding-reject',
  codingBranch: 'astra:coding-branch',
  codingApply: 'astra:coding-apply',
  codingCreateRepo: 'astra:coding-create-repo',
  codingRunCommand: 'astra:coding-run-command',
  codingReview: 'astra:coding-review',
  codingComplete: 'astra:coding-complete',
  codingCancel: 'astra:coding-cancel',
  codingRestore: 'astra:coding-restore',
  codingConfirm: 'astra:coding-confirm',
  codingEvents: 'astra:coding-events',
  codingDecide: 'astra:coding-decide',
  memoryAll: 'astra:memory-all',
  memorySummary: 'astra:memory-summary',
  memoryUpdate: 'astra:memory-update',
  memoryForgetText: 'astra:memory-forget-text',
  memorySuggestionsSet: 'astra:memory-suggestions-set',
  memorySuggestionsGet: 'astra:memory-suggestions-get',
} as const;

/** The single permitted workspace root for repository work. */
export const REPOSITORY_ROOT = 'C:\\Users\\karlr\\repos';

export interface KnowledgeSourceView {
  readonly id: number;
  readonly url: string;
  readonly host: string;
  readonly label: string;
  readonly approved: boolean;
  readonly status: string;
  readonly lastRefreshAt: string | null;
  readonly lastError: string | null;
  readonly documentCount: number;
}

export interface KnowledgePassageView {
  readonly text: string;
  readonly url: string;
  readonly title: string;
  readonly sourceLabel: string;
  readonly fetchedAt: string;
  readonly stale: boolean;
}

/** What Karl explicitly told Astra, as shown in the interface. */
export interface PersonalMemoryView {
  readonly id: number;
  readonly subject: string;
  readonly category: string;
  readonly statement: string;
  readonly origin: string;
  readonly provenance: string;
  readonly status: string;
  readonly sensitivity: string;
  readonly confidence: number;
  readonly conversationRef: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly forgottenAt: string | null;
}

/** Same record including ones Karl has already forgotten, for inspection. */
export interface PersonalMemoryRecordView extends PersonalMemoryView {
  readonly forgotten: boolean;
}

/** Startup summary: how many memories were loaded, and how fresh they are. */
export interface PersonalMemorySummaryView {
  readonly count: number;
  readonly revision: number;
  readonly loadedAt: string;
  readonly characters: number;
  readonly truncated: boolean;
}

export interface ProjectView {
  readonly name: string;
  readonly root: string;
  readonly hasGit: boolean;
  readonly languages: readonly string[];
  readonly frameworks: readonly string[];
  readonly testCommands: readonly string[];
  readonly fileCount: number;
  readonly description: string;
  readonly branch?: string | null;
  readonly clean?: boolean;
}

export interface IntelligenceBridge {
  // Learning
  listSources(): Promise<KnowledgeSourceView[]>;
  addSource(input: { url: string; label?: string; maxPages?: number; maxDepth?: number }): Promise<KnowledgeSourceView>;
  learnSource(id: number): Promise<{ documents: number; errors: readonly { url: string; reason: string }[] }>;
  revokeSource(id: number): Promise<void>;
  deleteSourceKnowledge(id: number): Promise<void>;
  searchKnowledge(query: string, limit?: number): Promise<KnowledgePassageView[]>;
  knowledgeStats(): Promise<{ sources: number; documents: number; chunks: number; bytes: number }>;

  // Personal memory. Every call is a validated operation on the local
  // database; none of them can be reached from website or repository content.
  listMemory(): Promise<PersonalMemoryView[]>;
  listAllMemory(): Promise<PersonalMemoryRecordView[]>;
  memorySummary(): Promise<PersonalMemorySummaryView>;
  rememberMemory(input: { statement: string; category?: string; subject?: string; conversationRef?: string }): Promise<PersonalMemoryView>;
  correctMemory(original: string, corrected: string, reason?: string): Promise<PersonalMemoryView>;
  updateMemory(input: { id: number; statement?: string; category?: string; subject?: string }): Promise<PersonalMemoryView>;
  forgetMemory(id: number): Promise<PersonalMemoryView>;
  forgetMemoryText(text: string): Promise<PersonalMemoryView[]>;
  listCorrections(): Promise<unknown[]>;
  setMemorySuggestions(enabled: boolean): Promise<boolean>;
  memorySuggestionsEnabled(): Promise<boolean>;

  // Projects
  listProjects(): Promise<ProjectView[]>;
  inspectProject(root: string): Promise<ProjectView>;
  readProjectFile(root: string, relativePath: string): Promise<{ text: string; truncated: boolean }>;
  searchProject(root: string, query: string): Promise<{ relativePath: string; line: number; text: string }[]>;

  // Approvals and audit
  requestApproval(input: { level: string; action: string; scope?: Record<string, unknown>; risk?: string }): Promise<unknown>;
  decideApproval(input: { id: number; approve: boolean; note?: string }): Promise<unknown>;
  listApprovals(): Promise<unknown[]>;
  listAudit(limit?: number): Promise<unknown[]>;

  // Coding tasks
  createTask(input: { repo: string; objective: string }): Promise<unknown>;
  listTasks(): Promise<unknown[]>;
  transitionTask(input: { id: number; state: string }): Promise<unknown>;
  cancelTask(input: { id: number; reason?: string }): Promise<unknown>;
  confirmTask(input: { id: number }): Promise<unknown>;
  taskEvents(input: { id: number }): Promise<unknown[]>;
  codingBenchmark(): Promise<{ model: string; reliability: number; usableForCoding: boolean; note: string }>;

  // ------------------------------------------------------- coding agent
  /** The single authoritative task state, shared by chat and the workspace. */
  codingSnapshot(): Promise<CodingTaskView>;
  codingSelectRepository(nameOrPath: string): Promise<string>;
  codingApprove(): Promise<CodingTaskView>;
  codingReject(reason?: string): Promise<CodingTaskView>;
  codingCreateBranch(): Promise<CodingTaskView>;
  codingApply(input: {
    patches?: { file: string; hunks: { find: string; replace: string }[] }[];
    writes?: { file: string; content: string }[];
  }): Promise<CodingTaskView>;
  codingCreateRepository(input: { name: string; files: Record<string, string> }): Promise<CodingTaskView>;
  codingRunCommand(input: { executable: string; args: string[] }): Promise<CodingTaskView>;
  codingReview(): Promise<CodingTaskView>;
  codingComplete(summary?: string): Promise<CodingTaskView>;
  codingCancel(reason?: string): Promise<CodingTaskView>;
  codingRestore(taskId: number): Promise<CodingTaskView>;
  codingConfirmResume(): Promise<CodingTaskView>;
  /**
   * Single decision entry point. Approve, reject, complete and resume all run
   * inside main so the renderer cannot advance the task past a check.
   */
  codingDecide(input: {
    decision: 'approve' | 'reject' | 'complete' | 'confirm';
    reason?: string;
    summary?: string;
  }): Promise<CodingTaskView>;
}

/** Serialisable view of the coding task, used by both views. */
export interface CodingTaskView {
  readonly taskId: number | null;
  readonly repository: string | null;
  readonly objective: string | null;
  readonly phase: string;
  readonly plan: {
    readonly objective: string;
    readonly repository: string;
    readonly filesToChange: readonly string[];
    readonly commands: readonly { executable: string; args: readonly string[]; purpose: string }[];
    readonly expectedOutcome: string;
    readonly risks: readonly string[];
    readonly rootCause: string;
    readonly investigationNotes: readonly string[];
    readonly patches?: readonly { readonly file: string; readonly hunks: readonly { readonly find: string; readonly replace: string }[] }[];
    readonly newRepository?: { readonly name: string; readonly files: Readonly<Record<string, string>> };
    /**
 * The exact operation Karl approved.
 *
 * The two `*_directory` actions are new: a directory is created empty, and a
 * directory delete is recursive. The latter always carries the full listing and
 * entry count that was shown before approval, so the workspace can display the
 * real scope of an irreversible deletion rather than a bare action name.
 */
readonly fileOperation?: {
      readonly action: 'create' | 'write' | 'edit' | 'delete' | 'create_directory' | 'delete_directory';
      readonly target: string;
      readonly content?: string;
      readonly beforeSha256: string | null;
      readonly createParent: boolean;
      readonly entries?: readonly string[];
      readonly entryCount?: number;
      readonly containsGit?: boolean;
    };
    readonly correctionAttempt?: number;
    readonly branch?: string | null;
  } | null;
  readonly approval: { requested: boolean; approved: boolean };
  readonly changes: readonly { file: string; action: string; applied: number }[];
  readonly testResults: readonly { command: string; cwd?: string; exitCode: number | null; ok: boolean; status?: 'passed' | 'failed' | 'skipped'; summary: string; output?: string; durationMs?: number; timedOut?: boolean; truncated?: boolean }[];
  readonly diff: { diff: string; filesChanged: number; insertions: number; deletions: number } | null;
  readonly workingTree: { branch: string | null; clean: boolean; staged: number; unstaged: number; untracked: number } | null;
  readonly error: string | null;
  readonly requiresConfirmation: boolean;
  readonly events: readonly { id: number; at: string; kind: string; label: string; ok: boolean; detail?: string }[];
}
