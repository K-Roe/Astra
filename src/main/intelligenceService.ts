import { app } from 'electron';
import path from 'node:path';
import { AstraDatabase, openDatabase } from './knowledge/database';
import { KnowledgeStore } from './knowledge/knowledgeStore';
import { MemoryStore } from './knowledge/memoryStore';
import { PersonalMemoryService, type PersonalMemory, type PersonalMemorySummary } from './memory/personalMemory';
import { MemoryCommands } from './memory/memoryCommands';
import type { MemoryChatPort } from './chatService';
import { ApprovalManager } from './approvals/approvalManager';
import { buildGrounding } from './knowledge/grounding';
import { TaskStore } from './agent/taskStore';
import { CodingAgent } from './agent/codingAgent';
import { CodingBridge } from './agent/codingBridge';
import { proposeCodingPatch } from './agent/codingModel';
import { crawlApprovedSource } from './research/reader';
import { UrlRejected } from './research/urlGuard';
import {
  describeProject,
  discoverRepositories,
  readProjectFile,
  searchProjectCode,
  type DiscoveredRepo,
} from './workspace/repoTools';
import { resolveWithinRoot, type SandboxOptions } from './workspace/pathGuard';
import { gitStatus } from './workspace/fileTools';
import {
  CONVERSATION_MODEL,
  CODING_MODEL,
  PRELIMINARY_CODING_RELIABILITY,
  routeTask,
  summarizeBenchmark,
  type BenchmarkCaseResult,
} from './models/codingBenchmark';
import { REPOSITORY_ROOT, type IntelligenceBridge, type KnowledgeSourceView, type CodingTaskView } from '../shared/intelligence';

/**
 * The intelligence service layer.
 *
 * Assembled once in main and exposed to the renderer through typed IPC. Every
 * method that touches the network, the filesystem or a database validates
 * again at the point of use, because a plan made earlier is not a guarantee
 * about the world now.
 */
export class IntelligenceService implements IntelligenceBridge {
  readonly db: AstraDatabase;
  readonly knowledge: KnowledgeStore;
  readonly memory: MemoryStore;
  readonly personal: PersonalMemoryService;
  readonly approvals: ApprovalManager;
  readonly tasks: TaskStore;
  readonly sandbox: SandboxOptions;
  private conversationCounter = 0;
  private codingReliability = PRELIMINARY_CODING_RELIABILITY;
  private benchmarkReport: { model: string; reliability: number; usableForCoding: boolean; note: string } | null = {
    model: CODING_MODEL,
    reliability: PRELIMINARY_CODING_RELIABILITY,
    usableForCoding: true,
    note: 'Intelligence V1 recorded 5/6 on six short cases. This is preliminary evidence for bounded proposals only; each patch needs validation, approval and tests.',
  };

  constructor(options: { databasePath: string; repositoryRoot?: string }) {
    const opened = openDatabase(options.databasePath);
    this.db = opened.db;
    this.knowledge = new KnowledgeStore(this.db);
    this.memory = new MemoryStore(this.db);
    this.personal = new PersonalMemoryService(this.db, this.memory);
    this.approvals = new ApprovalManager(this.db);
    this.tasks = new TaskStore(this.db);
    this.sandbox = { root: options.repositoryRoot ?? REPOSITORY_ROOT };
    if (opened.recovered) {
      this.approvals.record({ actor: 'system', action: 'database.recovered', result: 'recovered', detail: { from: opened.recoveredFrom } });
    }
  }

  /** Surface anything that was in flight at the last shutdown for confirmation. */
  recoverInterruptedTasks(): readonly { id: number; objective: string; state: string }[] {
    return this.tasks.recoverOnStartup().map((t) => ({ id: t.id, objective: t.objective, state: t.state }));
  }

  // ------------------------------------------------------------- learning

  async listSources(): Promise<KnowledgeSourceView[]> {
    return this.knowledge.listSources().map((source) => ({
      ...source,
      documentCount: this.knowledge.listDocuments(source.id).length,
    }));
  }

  async addSource(input: { url: string; label?: string; maxPages?: number; maxDepth?: number }): Promise<KnowledgeSourceView> {
    // Reject anything that is not a plain HTTPS origin before it is stored,
    // so an unusable source never appears as approved.
    const parsed = new URL(input.url);
    if (parsed.protocol !== 'https:') throw new Error('only HTTPS sources are supported');
    if (parsed.username || parsed.password) throw new Error('credentials are not allowed in a source URL');
    if (parsed.port && parsed.port !== '443') throw new Error('only the standard HTTPS port is supported');
    const source = this.knowledge.addSource({
      url: parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname),
      host: parsed.hostname,
      label: input.label ?? parsed.hostname,
      maxPages: input.maxPages ?? 5,
      maxDepth: input.maxDepth ?? 1,
      pathPrefix: parsed.pathname === '/' ? '/' : parsed.pathname,
    });
    this.approvals.record({ actor: 'karl', action: 'source.approve', target: source.url });
    return { ...source, documentCount: 0 };
  }

  async learnSource(id: number): Promise<{ documents: number; errors: readonly { url: string; reason: string }[] }> {
    const source = this.knowledge.requireSource(id);
    if (!source.approved) throw new Error('this source is revoked; reinstate it before learning');

    const sourceUrl = new URL(source.url);
    const boundary = this.knowledge.boundaryFor(source, sourceUrl.pathname === '/' ? '/' : sourceUrl.pathname);
    let stored = 0;
    try {
      const result = await crawlApprovedSource(source.url, boundary, {
        limits: { maxPages: source.maxPages, maxDepth: source.maxDepth },
      });
      for (const page of result.pages) {
        this.knowledge.storeDocument({
          sourceId: source.id,
          url: page.url,
          title: page.page.title,
          text: page.page.text,
          bytes: page.bytes,
          publishedAt: page.publishedAt,
          updatedAt: page.updatedAt,
        });
        stored += 1;
      }
      this.knowledge.recordSourceRefresh(source.id, null);
      this.approvals.record({ actor: 'astra', action: 'source.learn', target: source.url, detail: { stored, errors: result.errors.length } });
      return { documents: stored, errors: result.errors };
    } catch (error) {
      const reason = error instanceof UrlRejected ? `${error.reason}: ${error.url}` : error instanceof Error ? error.message : String(error);
      this.knowledge.recordSourceRefresh(source.id, reason);
      this.knowledge.markStale(source.id);
      this.approvals.record({ actor: 'astra', action: 'source.learn', target: source.url, result: 'failed', detail: { reason } });
      return { documents: 0, errors: [{ url: source.url, reason }] };
    }
  }

  async revokeSource(id: number): Promise<void> {
    this.approvals.assertApproved('source.revoke', { id });
    this.knowledge.revokeSource(id);
    this.approvals.record({ actor: 'karl', action: 'source.revoke', target: String(id) });
  }

  async deleteSourceKnowledge(id: number): Promise<void> {
    this.approvals.assertApproved('source.delete_knowledge', { id });
    this.knowledge.deleteSourceKnowledge(id);
    this.approvals.record({ actor: 'karl', action: 'source.delete_knowledge', target: String(id) });
  }

  async searchKnowledge(query: string, limit = 6) {
    return this.knowledge.search(query, limit).map((p) => ({
      text: p.text,
      url: p.documentUrl,
      title: p.documentTitle,
      sourceLabel: p.sourceLabel,
      fetchedAt: p.fetchedAt,
      stale: p.stale,
    }));
  }

  async knowledgeStats() {
    return this.knowledge.knowledgeStats();
  }

  // --------------------------------------------------------------- memory

  /**
   * Startup load. The active personal memories are read once here so the first
   * reply of a session already knows them, and the count is reported honestly
   * rather than being re-read on every prompt.
   */
  loadPersonalMemory(): PersonalMemorySummary {
    const summary = this.personal.summary();
    this.approvals.record({
      actor: 'system',
      action: 'memory.loaded',
      result: 'ok',
      detail: { count: summary.count, revision: summary.revision },
    });
    return summary;
  }

  async listMemory(): Promise<PersonalMemory[]> {
    return this.personal.listActive(200);
  }

  async listAllMemory(): Promise<(PersonalMemory & { forgotten: boolean })[]> {
    return this.personal.listAll(200);
  }

  async memorySummary(): Promise<PersonalMemorySummary> {
    return this.personal.summary();
  }

  async rememberMemory(input: { statement: string; category?: string; subject?: string; conversationRef?: string }) {
    // The renderer may only add memory on Karl's explicit request from the
    // Personal Memory panel. Nothing here is reachable from web or file content.
    const record = this.personal.remember({
      statement: input.statement,
      category: input.category ?? 'preference',
      subject: input.subject ?? `preference.${input.statement.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`,
      origin: 'ui_edit',
      conversationRef: input.conversationRef ?? null,
    });
    this.approvals.record({ actor: 'karl', action: 'memory.remember', target: record.subject });
    return record;
  }

  async correctMemory(original: string, corrected: string, reason = ''): Promise<PersonalMemory> {
    // Supersede the old statement and store the correction as a first-class
    // personal memory, so the correction history stays auditable.
    const subject = `preference.${corrected.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`;
    const record = this.personal.remember({ statement: corrected, category: 'correction', subject, origin: 'user_correction' });
    this.db.transaction(() => {
      this.db.run(
        `UPDATE memory SET active = 0, status = 'superseded', superseded_reason = ?, updated_at = ?
         WHERE active = 1 AND statement = ? AND id <> ?`,
        `corrected to statement ${record.id}`, new Date().toISOString(), original, record.id,
      );
      this.db.run(
        `INSERT INTO corrections(memory_id, original, corrected, reason, created_at) VALUES (?,?,?,?,?)`,
        null, original, corrected, reason, new Date().toISOString(),
      );
    });
    this.approvals.record({ actor: 'karl', action: 'memory.correct', target: record.subject });
    return record;
  }

  async updateMemory(input: { id: number; statement?: string; category?: string; subject?: string }) {
    const record = this.personal.update(input.id, input);
    this.approvals.record({ actor: 'karl', action: 'memory.update', target: record.subject });
    return record;
  }

  async forgetMemory(id: number): Promise<PersonalMemory> {
    const record = this.personal.forget(id);
    this.approvals.record({ actor: 'karl', action: 'memory.forget', target: record.subject || String(id) });
    return record;
  }

  async forgetMemoryText(text: string): Promise<PersonalMemory[]> {
    const removed = this.personal.forgetByText(text);
    this.approvals.record({ actor: 'karl', action: 'memory.forget_by_text', detail: { text: text.slice(0, 80), count: removed.length } });
    return removed;
  }

  async listCorrections() {
    return this.personal.listCorrections();
  }

  async setMemorySuggestions(enabled: boolean): Promise<boolean> {
    this.personal.setSetting('memory.suggestions', enabled ? 'on' : 'off');
    this.approvals.record({ actor: 'karl', action: 'memory.suggestions', target: enabled ? 'on' : 'off' });
    return enabled;
  }

  async memorySuggestionsEnabled(): Promise<boolean> {
    return this.personal.suggestionsEnabled();
  }

  /** The narrow port chat is given. Chat cannot reach the database directly. */
  chatMemoryPort(): MemoryChatPort {
    return {
      handle: (text) => new MemoryCommands(this.personal).handle(text, {
        conversationRef: this.conversationRef(),
        suggestionsEnabled: this.personal.suggestionsEnabled(),
      }),
      contextFor: (query) => {
        const block = this.personal.contextBlock(query);
        return {
          relevant: block.relevant.map((memory) => ({ category: memory.category, statement: memory.statement })),
          summary: block.summary.map((memory) => ({ category: memory.category, statement: memory.statement })),
        };
      },
      summary: () => this.personal.summary(),
      suggestionsEnabled: () => this.personal.suggestionsEnabled(),
      conversationRef: () => this.conversationRef(),
    };
  }

  /** Reference for memories captured in the current conversation. */
  private conversationRef(): string {
    if (!this.conversationRefValue) this.conversationRefValue = `conversation-${Date.now().toString(36)}-${++this.conversationCounter}`;
    return this.conversationRefValue;
  }

  private conversationRefValue: string | null = null;

  // ------------------------------------------------------------- projects

  private repos(): DiscoveredRepo[] {
    return discoverRepositories(this.sandbox);
  }

  async listProjects() {
    return Promise.all(this.repos().map(async (repo) => {
      const status = await gitStatus(repo.root, this.sandbox);
      return { ...this.view(repo), branch: status.branch, clean: status.clean };
    }));
  }

  private view(repo: DiscoveredRepo) {
    const described = describeProject(repo.root, this.sandbox);
    return {
      name: described.name,
      root: described.root,
      hasGit: described.hasGit,
      languages: described.detectedLanguages,
      frameworks: described.frameworks,
      testCommands: described.testCommands,
      fileCount: described.fileCount,
      description: described.description,
    };
  }

  async inspectProject(root: string) {
    const safe = this.requireDiscoveredProject(root);
    return this.view({ name: path.basename(safe), root: safe, hasGit: false, detectedLanguages: [], description: '' });
  }

  async readProjectFile(root: string, relativePath: string) {
    const safeRoot = this.requireDiscoveredProject(root);
    const result = readProjectFile(path.join(safeRoot, relativePath), { root: safeRoot });
    return { text: result.text, truncated: result.truncated };
  }

  async searchProject(root: string, query: string) {
    const safeRoot = this.requireDiscoveredProject(root);
    return searchProjectCode(safeRoot, { root: safeRoot }, query);
  }

  private requireDiscoveredProject(root: string): string {
    const safe = resolveWithinRoot(root, this.sandbox);
    if (!this.repos().some((repo) => repo.root.toLowerCase() === safe.toLowerCase())) throw new Error('project must be a discovered Git repository under the approved root');
    return safe;
  }

  // ------------------------------------------- approvals, audit and tasks

  async requestApproval(input: { level: string; action: string; scope?: Record<string, unknown>; risk?: string }) {
    const request = this.approvals.request({
      level: input.level as 'read_only',
      action: input.action,
      scope: input.scope,
      risk: input.risk,
    });
    this.approvals.record({ actor: 'astra', action: 'approval.request', target: input.action, detail: { id: request.id } });
    return request;
  }

  async decideApproval(input: { id: number; approve: boolean; note?: string }) {
    const decided = input.approve ? this.approvals.approve(input.id, input.note) : this.approvals.deny(input.id, input.note);
    this.approvals.record({ actor: 'karl', action: input.approve ? 'approval.grant' : 'approval.refuse', target: decided.action, detail: { id: input.id } });
    return decided;
  }

  async listApprovals() {
    return this.approvals.list();
  }

  async listAudit(limit = 100) {
    return this.approvals.audit(limit);
  }

  async createTask(input: { repo: string; objective: string }) {
    // Creating a task record is not itself a privileged action, but naming a
    // repository is: resolve and contain it now.
    const repo = resolveWithinRoot(input.repo, this.sandbox);
    const routing = routeTask('coding', { codingReliability: this.codingReliability });
    return this.tasks.create({ repo, objective: input.objective, model: routing.model });
  }

  async listTasks() {
    return this.tasks.list();
  }

  async transitionTask(input: { id: number; state: string }) {
    return this.tasks.transition(input.id, input.state as Parameters<TaskStore['transition']>[1]);
  }

  async cancelTask(input: { id: number; reason?: string }) {
    return this.tasks.cancel(input.id, input.reason);
  }

  async confirmTask(input: { id: number }) {
    return this.tasks.confirmResume(input.id);
  }

  async taskEvents(input: { id: number }) {
    return this.tasks.events(input.id);
  }

  /** Last measured coding capability; routes only what the evidence supports. */
  setCodingBenchmark(results: readonly BenchmarkCaseResult[]) {
    const report = summarizeBenchmark(this.benchmarkModel ?? 'unknown', results);
    this.codingReliability = report.reliability;
    this.benchmarkReport = { model: report.model, reliability: report.reliability, usableForCoding: report.usableForCoding, note: report.note };
    return report;
  }

  private benchmarkModel = CODING_MODEL;
  private agent: CodingAgent | null = null;
  private bridge: CodingBridge | null = null;
  private activeCodingRun: Promise<void> | null = null;

  async codingBenchmark(): Promise<{ model: string; reliability: number; usableForCoding: boolean; note: string }> {
    return this.benchmarkReport ?? {
      model: CONVERSATION_MODEL,
      reliability: 0,
      usableForCoding: false,
      note: 'No coding benchmark has been run yet; coding work is not delegated.',
    };
  }

  /** Model routing decision for the current evidence. */
  routingFor(kind: 'conversation' | 'coding' | 'research') {
    return routeTask(kind, { codingReliability: this.codingReliability });
  }

  /** Retrieval hook handed to the chat service so answers can be grounded. */
  groundQuery(query: string) {
    return buildGrounding(query, this.knowledge, this.memory);
  }

  /**
   * The single coding task engine, shared by chat and the Coding workspace.
   * Created once so both views always read the same authoritative state.
   */
  get codingAgent(): CodingAgent {
    if (!this.agent) {
      this.agent = new CodingAgent(this.sandbox, this.approvals, this.tasks, this.memory);
    }
    return this.agent;
  }

  /**
   * Chat's handle onto the coding tools. Built once and shared, so a coding
   * request handled in conversation moves the same task the workspace shows.
   */
  get codingBridge(): CodingBridge {
    if (!this.bridge) this.bridge = new CodingBridge(this.codingAgent, this.sandbox, proposeCodingPatch, () => this.activeCodingRun !== null, () => this.routingFor('coding'));
    return this.bridge;
  }

  // ------------------------------------------------------- coding agent IPC

  private codingView(): CodingTaskView {
    const s = this.codingAgent.snapshot();
    return {
      taskId: s.taskId,
      repository: s.repository,
      objective: s.objective,
      phase: s.phase,
      plan: s.plan,
      approval: { requested: s.approval.requested, approved: s.approval.approved },
      changes: s.changes,
      testResults: s.testResults,
      diff: s.diff,
      workingTree: s.workingTree
        ? {
            branch: s.workingTree.branch,
            clean: s.workingTree.clean,
            staged: s.workingTree.staged,
            unstaged: s.workingTree.unstaged,
            untracked: s.workingTree.untracked,
          }
        : null,
      error: s.error,
      requiresConfirmation: s.requiresConfirmation,
      events: s.events,
    };
  }

  async codingSnapshot(): Promise<CodingTaskView> {
    if (this.codingAgent.snapshot().taskId === null) {
      const active = this.tasks.active();
      if (active) await this.codingAgent.restore(active.id);
    }
    return this.codingView();
  }
  async codingSelectRepository(nameOrPath: string): Promise<string> { return this.codingAgent.selectRepository(nameOrPath); }
  async codingApprove(): Promise<CodingTaskView> { this.codingAgent.approve(); return this.codingView(); }
  async codingReject(reason?: string): Promise<CodingTaskView> { this.codingAgent.reject(reason); return this.codingView(); }
  async codingCreateBranch(): Promise<CodingTaskView> { this.assertNoConcurrentCodingRun(); await this.codingAgent.createTaskBranch(); return this.codingView(); }
  async codingApply(input: { patches?: { file: string; hunks: { find: string; replace: string }[] }[]; writes?: { file: string; content: string }[] }): Promise<CodingTaskView> {
    this.assertNoConcurrentCodingRun();
    await this.codingAgent.createTaskBranch();
    await this.codingAgent.implement({ patches: input.patches ?? [], ...(input.writes ? { writes: input.writes } : {}) });
    return this.codingView();
  }
  async codingCreateRepository(input: { name: string; files: Record<string, string> }): Promise<CodingTaskView> {
    this.assertNoConcurrentCodingRun();
    await this.codingAgent.createRepository(input);
    return this.codingView();
  }
  async codingRunCommand(input: { executable: string; args: string[] }): Promise<CodingTaskView> {
    this.assertNoConcurrentCodingRun();
    await this.codingAgent.runApprovedCommand(input.executable, input.args);
    return this.codingView();
  }
  async codingReview(): Promise<CodingTaskView> {
    this.assertNoConcurrentCodingRun();
    await this.codingAgent.review();
    return this.codingView();
  }
  async codingComplete(summary?: string): Promise<CodingTaskView> { this.assertNoConcurrentCodingRun(); await this.codingAgent.complete(summary); return this.codingView(); }
  async codingCancel(reason?: string): Promise<CodingTaskView> {
    await this.codingAgent.cancel(reason);
    return this.codingView();
  }
  async codingRestore(taskId: number): Promise<CodingTaskView> {
    await this.codingAgent.restore(taskId);
    return this.codingView();
  }
  async codingConfirmResume(): Promise<CodingTaskView> { this.codingAgent.confirmResume(); return this.codingView(); }

  private assertNoConcurrentCodingRun(): void {
    if (this.activeCodingRun) throw new Error('the approved coding workflow is already running');
  }

  /** Apply approval and completion inside the service so IPC cannot bypass. */
  async codingDecide(input: { decision: 'approve' | 'reject' | 'complete' | 'confirm'; reason?: string; summary?: string }): Promise<CodingTaskView> {
    return this.applyCodingDecision(input.decision, input);
  }

  /** Apply approval and completion inside the service so IPC cannot bypass. */
  async applyCodingDecision(kind: 'approve' | 'reject' | 'complete' | 'confirm', input: { reason?: string; summary?: string }): Promise<CodingTaskView> {
    const agent = this.codingAgent;
    if (kind === 'approve') {
      if (this.activeCodingRun) {
        // A failed check can publish a fresh approval request just before the
        // previous background promise clears. Let that run settle first;
        // never overlap two executors or drop Karl's correction approval.
        if (agent.snapshot().phase !== 'awaiting_approval') throw new Error('a coding task is already running');
        await this.activeCodingRun;
      }
      if (this.activeCodingRun) throw new Error('a coding task is already running');
      agent.approve();
      const taskId = agent.snapshot().taskId;
      // The renderer gets an immediate response. Work continues in main and is
      // visible through the shared snapshot; cancellation has its own IPC call.
      this.activeCodingRun = Promise.resolve().then(() => this.executeApproved(taskId)).catch((error: unknown) => {
        if (agent.snapshot().taskId === taskId && !agent.isStopping()) {
          agent.fail(error instanceof Error ? error.message : String(error));
        }
      }).finally(() => { this.activeCodingRun = null; });
    }
    else if (kind === 'reject') {
      // Reject is always recorded as a rejection of the exact pending operation.
      // If an executor is still running, cancel it first so the in-flight promise
      // cannot continue, then record the rejection on the same task.
      if (this.activeCodingRun) {
        await agent.cancel(input.reason ?? 'approval withdrawn');
      } else {
        agent.reject(input.reason);
      }
    }
    else if (kind === 'complete') {
      this.assertNoConcurrentCodingRun();
      const phase = agent.snapshot().phase;
      if (phase === 'cancelled') throw new Error(`the task is ${phase}; a rejected or cancelled operation is never reported as completed work`);
      await agent.complete(input.summary);
    }
    else { this.assertNoConcurrentCodingRun(); agent.confirmResume(); }
    return this.codingView();
  }

  private async executeApproved(taskId: number | null): Promise<void> {
    const agent = this.codingAgent;
    const plan = agent.snapshot().plan;
    if (!taskId || !plan || agent.snapshot().taskId !== taskId) throw new Error('approved task changed');
    const alreadyPresent = await agent.implementationAlreadyPresent();
    if (alreadyPresent) {
      // The exact prior edit/scaffold is on disk; tests still need fresh approval.
    } else if (plan.newRepository) {
      await agent.createRepository(plan.newRepository);
    } else if (plan.fileOperation) {
      agent.executeFileOperation();
    } else if (plan.patches?.length) {
      if (plan.branch) await agent.createTaskBranch();
      await agent.implement({ patches: plan.patches });
    } else {
      throw new Error('approved plan contains no bounded work');
    }
    if (agent.isStopping()) return;
    for (const command of plan.commands) {
      const result = await agent.runApprovedCommand(command.executable, command.args);
      if (agent.isStopping()) return;
      if (!result.testResults.at(-1)?.ok) {
        if (plan.patches?.length && (plan.correctionAttempt ?? 0) < 1) {
          const failure = result.testResults.at(-1);
          try {
            const route = this.routingFor('coding');
            if (!route.permitted) throw new Error(route.reason);
            const correction = await proposeCodingPatch(
              `${plan.objective}\nThe approved check failed. Propose a correction within the same files. Output: ${failure?.output?.slice(0, 1500) ?? failure?.summary ?? ''}`,
              plan.repository,
              plan.filesToChange,
              this.sandbox,
            );
            await agent.proposeCorrection(correction);
          } catch (error) {
            if (!agent.isStopping()) agent.fail(`Approved check failed; a safe correction was unavailable: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          agent.fail(`Approved check failed: ${result.testResults.at(-1)?.summary ?? 'unknown result'}`);
        }
        return;
      }
    }
    if (agent.isStopping()) return;
    await agent.review();
    if (!agent.isStopping()) await agent.complete('approved work and checks finished');
  }

  close(): void {
    this.db.close();
  }

  async shutdown(): Promise<void> {
    if (this.agent && this.activeCodingRun && ['implementing', 'testing'].includes(this.agent.snapshot().phase) && !this.agent.isStopping()) {
      await this.agent.pauseForShutdown();
    }
    await this.activeCodingRun?.catch(() => undefined);
    this.close();
  }
}

/** Default location: the Electron user-data directory, never the repository. */
export function defaultDatabasePath(): string {
  return path.join(app.getPath('userData'), 'astra-intelligence.db');
}
