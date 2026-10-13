import { app } from 'electron';
import path from 'node:path';
import { AstraDatabase, openDatabase } from './knowledge/database';
import { KnowledgeStore } from './knowledge/knowledgeStore';
import { MemoryStore } from './knowledge/memoryStore';
import { ApprovalManager } from './approvals/approvalManager';
import { buildGrounding } from './knowledge/grounding';
import { TaskStore } from './agent/taskStore';
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
import {
  CONVERSATION_MODEL,
  routeTask,
  summarizeBenchmark,
  type BenchmarkCaseResult,
} from './models/codingBenchmark';
import { REPOSITORY_ROOT, type IntelligenceBridge, type KnowledgeSourceView } from '../shared/intelligence';

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
  readonly approvals: ApprovalManager;
  readonly tasks: TaskStore;
  readonly sandbox: SandboxOptions;
  private codingReliability = 0;
  private benchmarkReport: { model: string; reliability: number; usableForCoding: boolean; note: string } | null = null;

  constructor(options: { databasePath: string; repositoryRoot?: string }) {
    const opened = openDatabase(options.databasePath);
    this.db = opened.db;
    this.knowledge = new KnowledgeStore(this.db);
    this.memory = new MemoryStore(this.db);
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

  async listMemory() {
    return this.memory.active(200);
  }

  async rememberMemory(input: { statement: string; category?: string }) {
    const category = (input.category ?? 'preference') as Parameters<MemoryStore['remember']>[0]['category'];
    const record = this.memory.remember({ category, statement: input.statement, provenance: 'karl_explicit', origin: 'karl', confidence: 0.9 });
    this.approvals.record({ actor: 'karl', action: 'memory.remember', target: record.statement.slice(0, 80) });
    return record;
  }

  async correctMemory(original: string, corrected: string, reason = '') {
    const record = this.memory.correct(original, corrected, reason);
    this.approvals.record({ actor: 'karl', action: 'memory.correct', target: corrected.slice(0, 80) });
    return record;
  }

  async forgetMemory(id: number): Promise<void> {
    this.memory.forget(id);
    this.approvals.record({ actor: 'karl', action: 'memory.forget', target: String(id) });
  }

  async listCorrections() {
    return this.memory.listCorrections();
  }

  // ------------------------------------------------------------- projects

  private repos(): DiscoveredRepo[] {
    return discoverRepositories(this.sandbox);
  }

  async listProjects() {
    return this.repos().map((repo) => this.view(repo));
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
    const safe = resolveWithinRoot(root, this.sandbox);
    return this.view({ name: path.basename(safe), root: safe, hasGit: false, detectedLanguages: [], description: '' });
  }

  async readProjectFile(root: string, relativePath: string) {
    const safeRoot = resolveWithinRoot(root, this.sandbox);
    const result = readProjectFile(path.join(safeRoot, relativePath), this.sandbox);
    return { text: result.text, truncated: result.truncated };
  }

  async searchProject(root: string, query: string) {
    const safeRoot = resolveWithinRoot(root, this.sandbox);
    return searchProjectCode(safeRoot, this.sandbox, query);
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

  private benchmarkModel = CONVERSATION_MODEL;

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

  close(): void {
    this.db.close();
  }
}

/** Default location: the Electron user-data directory, never the repository. */
export function defaultDatabasePath(): string {
  return path.join(app.getPath('userData'), 'astra-intelligence.db');
}