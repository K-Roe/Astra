import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CodingTaskView, IntelligenceBridge } from '../../shared/intelligence';

/**
 * Shared handle on the single coding task engine in main.
 *
 * Both the conversation and the Coding workspace use this, so they cannot drift
 * apart: there is one authoritative task and one snapshot source. The session
 * polls rather than pushes, because main has no event channel to the renderer;
 * polling is cheap (a snapshot of a small object) and keeps the boundary narrow.
 */

export type IntelligenceResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function bridge(): IntelligenceBridge {
  const api = (globalThis as { astraIntelligence?: IntelligenceBridge }).astraIntelligence;
  if (!api) throw new Error('The coding service is unavailable in this build.');
  return api;
}

async function attempt<T>(work: () => Promise<T>): Promise<IntelligenceResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const POLL_MS = 700;

export interface CodingSession {
  snapshot(): Promise<IntelligenceResult<CodingTaskView>>;
  selectRepository(root: string): Promise<IntelligenceResult<CodingTaskView>>;
  decide(kind: 'approve' | 'reject' | 'confirm'): Promise<IntelligenceResult<CodingTaskView>>;
  apply(patches: { file: string; hunks: { find: string; replace: string }[] }[]): Promise<IntelligenceResult<CodingTaskView>>;
  runCommand(executable: string, args: string[]): Promise<IntelligenceResult<CodingTaskView>>;
  review(): Promise<IntelligenceResult<CodingTaskView>>;
  complete(summary?: string): Promise<IntelligenceResult<CodingTaskView>>;
  cancel(reason?: string): Promise<IntelligenceResult<CodingTaskView>>;
  restore(taskId: number): Promise<IntelligenceResult<CodingTaskView>>;
  listTasks(): Promise<IntelligenceResult<{ id: number; objective: string; state: string }[]>>;
  /** Subscribe to engine changes (approval, apply, run, review). */
  onChange(listener: () => void): () => void;
}

export function useCodingSession(): CodingSession {
  const listeners = useRef(new Set<() => void>());
  const version = useRef(0);

  const notify = useCallback(() => {
    version.current += 1;
    for (const listener of listeners.current) listener();
  }, []);

  const snapshot = useCallback(async () => attempt(() => bridge().codingSnapshot()), []);

  useEffect(() => {
    // Poll while a task is active so the workspace reflects work started in
    // chat, and work started in the workspace appears in chat on the next poll.
    const timer = setInterval(async () => {
      const result = await attempt(() => bridge().codingSnapshot());
      if (!result.ok) return;
      const previous = version.current;
      const active = result.value.phase !== 'idle' || result.value.taskId !== null;
      if (active) notify();
      void previous;
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [notify]);

  const onChange = useCallback(
    (listener: () => void) => {
      listeners.current.add(listener);
      return () => {
        listeners.current.delete(listener);
      };
    },
    [],
  );

  const wrap = useCallback(
    (work: () => Promise<CodingTaskView>) => async (): Promise<IntelligenceResult<CodingTaskView>> => {
      const result = await attempt(work);
      notify();
      return result;
    },
    [notify],
  );

  return useMemo(() => ({
    snapshot,
    onChange,
    selectRepository: async (root: string) =>
      wrap(async () => {
        await bridge().codingSelectRepository(root);
        return bridge().codingSnapshot();
      })(),
    decide: (kind) => wrap(() => bridge().codingDecide({ decision: kind }))(),
    apply: (patches) => wrap(() => bridge().codingApply({ patches }))(),
    runCommand: (executable, args) => wrap(() => bridge().codingRunCommand({ executable, args }))(),
    review: wrap(() => bridge().codingReview()),
    complete: (summary) => wrap(() => bridge().codingDecide({ decision: 'complete', ...(summary ? { summary } : {}) }))(),
    cancel: (reason) => wrap(() => bridge().codingCancel(reason))(),
    restore: (taskId) => wrap(() => bridge().codingRestore(taskId))(),
    listTasks: async () =>
      attempt(async () => {
        const tasks = await bridge().listTasks() as { id: number; objective: string; state: string }[];
        return tasks.map((task) => ({ id: task.id, objective: task.objective, state: task.state }));
      }),
  }), [snapshot, onChange, wrap]);
}
