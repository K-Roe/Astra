import type { IntelligenceBridge, KnowledgeSourceView, ProjectView } from '../../shared/intelligence';

/**
 * Thin, typed wrapper around the intelligence bridge.
 *
 * The renderer has no Node access: every privileged action is a message to
 * main. This module exists so components can be written as plain async
 * functions, and so that a missing bridge produces a clear message rather than
 * a confusing `undefined` error during development.
 */

export type IntelligenceResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export function intelligence(): IntelligenceBridge {
  const bridge = (globalThis as { astraIntelligence?: IntelligenceBridge }).astraIntelligence;
  if (!bridge) throw new Error('The intelligence service is unavailable in this build.');
  return bridge;
}

async function attempt<T>(work: () => Promise<T>): Promise<IntelligenceResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export const learning = {
  listSources: () => attempt(() => intelligence().listSources()),
  addSource: (input: { url: string; label?: string }) => attempt(() => intelligence().addSource(input)),
  learnSource: (id: number) => attempt(() => intelligence().learnSource(id)),
  revokeSource: (id: number) => attempt(() => intelligence().revokeSource(id)),
  deleteSource: (id: number) => attempt(() => intelligence().deleteSourceKnowledge(id)),
  search: (query: string) => attempt(() => intelligence().searchKnowledge(query, 6)),
  stats: () => attempt(() => intelligence().knowledgeStats()),
};

export const memory = {
  list: () => attempt(() => intelligence().listMemory()),
  remember: (statement: string) => attempt(() => intelligence().rememberMemory({ statement })),
  correct: (original: string, corrected: string, reason = '') => attempt(() => intelligence().correctMemory(original, corrected, reason)),
  forget: (id: number) => attempt(() => intelligence().forgetMemory(id)),
  corrections: () => attempt(() => intelligence().listCorrections()),
};

export const projects = {
  list: () => attempt(() => intelligence().listProjects()),
  inspect: (root: string) => attempt(() => intelligence().inspectProject(root)),
  readFile: (root: string, relativePath: string) => attempt(() => intelligence().readProjectFile(root, relativePath)),
  search: (root: string, query: string) => attempt(() => intelligence().searchProject(root, query)),
};

export const approvals = {
  list: () => attempt(() => intelligence().listApprovals()),
  decide: (id: number, approve: boolean, note = '') => attempt(() => intelligence().decideApproval({ id, approve, note })),
};

export const audit = {
  list: (limit = 50) => attempt(() => intelligence().listAudit(limit)),
};

export const coding = {
  benchmark: () => attempt(() => intelligence().codingBenchmark()),
  listTasks: () => attempt(() => intelligence().listTasks() as Promise<unknown[]>),
  createTask: (repo: string, objective: string) => attempt(() => intelligence().createTask({ repo, objective })),
  transitionTask: (id: number, state: string) => attempt(() => intelligence().transitionTask({ id, state })),
  cancelTask: (id: number, reason = '') => attempt(() => intelligence().cancelTask({ id, reason })),
  confirmTask: (id: number) => attempt(() => intelligence().confirmTask({ id })),
  requestApproval: (input: { level: string; action: string; scope?: Record<string, unknown>; risk?: string }) =>
    attempt(() => intelligence().requestApproval(input)),
};

export type { KnowledgeSourceView, ProjectView };