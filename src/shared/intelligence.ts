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

export interface ProjectView {
  readonly name: string;
  readonly root: string;
  readonly hasGit: boolean;
  readonly languages: readonly string[];
  readonly frameworks: readonly string[];
  readonly testCommands: readonly string[];
  readonly fileCount: number;
  readonly description: string;
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

  // Memory
  listMemory(): Promise<unknown[]>;
  rememberMemory(input: { statement: string; category?: string }): Promise<unknown>;
  correctMemory(original: string, corrected: string, reason?: string): Promise<unknown>;
  forgetMemory(id: number): Promise<void>;
  listCorrections(): Promise<unknown[]>;

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
}