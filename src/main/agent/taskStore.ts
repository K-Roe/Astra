import type { AstraDatabase } from '../knowledge/database';

/**
 * Persistent coding-task lifecycle.
 *
 * The task record survives restarts, but nothing resumes on its own: a task
 * found at startup is always returned with `requiresConfirm` set, so Karl has
 * to re-approve before any executable work continues. That is the difference
 * between recovering context and silently carrying on.
 */

export type TaskState =
  | 'draft'
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

/** States in which a task may perform filesystem or command operations. */
const EXECUTABLE_STATES: ReadonlySet<TaskState> = new Set(['implementing', 'testing']);

/** States from which no further work is possible. */
const TERMINAL_STATES: ReadonlySet<TaskState> = new Set(['completed', 'failed', 'cancelled']);

const ALLOWED: Readonly<Record<TaskState, readonly TaskState[]>> = {
  draft: ['investigating', 'cancelled'],
  investigating: ['planning', 'failed', 'paused', 'cancelled'],
  planning: ['awaiting_approval', 'draft', 'failed', 'cancelled'],
  awaiting_approval: ['implementing', 'failed', 'cancelled'],
  implementing: ['testing', 'reviewing', 'failed', 'paused', 'cancelled'],
  testing: ['implementing', 'reviewing', 'failed', 'paused', 'cancelled'],
  reviewing: ['completed', 'implementing', 'failed', 'cancelled'],
  completed: [],
  failed: ['investigating', 'cancelled'],
  paused: ['investigating', 'implementing', 'cancelled'],
  cancelled: [],
};

export class TaskTransitionError extends Error {
  constructor(from: TaskState, to: TaskState) {
    super(`a task cannot move from ${from} to ${to}`);
    this.name = 'TaskTransitionError';
  }
}

export interface CodingTask {
  readonly id: number;
  readonly repo: string;
  readonly objective: string;
  readonly state: TaskState;
  readonly model: string;
  readonly plan: Readonly<Record<string, unknown>>;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly changes: readonly unknown[];
  readonly testResults: readonly unknown[];
  readonly error: string | null;
  readonly recovery: Readonly<Record<string, unknown>>;
  readonly requiresConfirm: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class TaskStore {
  constructor(private readonly db: AstraDatabase) {}

  create(input: { repo: string; objective: string; model?: string }): CodingTask {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO coding_tasks(repo, objective, state, model, created_at, updated_at, requires_confirm)
       VALUES (?,?,'draft',?,?,?,0)`,
      input.repo,
      input.objective,
      input.model ?? '',
      now,
      now,
    );
    const id = this.lastId();
    this.event(id, 'created', input.objective.slice(0, 300));
    return this.require(id);
  }

  get(id: number): CodingTask | undefined {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM coding_tasks WHERE id = ?', id);
    return row ? toTask(row) : undefined;
  }

  list(limit = 50): CodingTask[] {
    return this.db.all<Record<string, unknown>>('SELECT * FROM coding_tasks ORDER BY id DESC LIMIT ?', limit).map(toTask);
  }

  /** The most recent task that is not finished. */
  active(): CodingTask | undefined {
    const row = this.db.get<Record<string, unknown>>(
      "SELECT * FROM coding_tasks WHERE state NOT IN ('completed','cancelled') ORDER BY id DESC LIMIT 1",
    );
    return row ? toTask(row) : undefined;
  }

  canTransition(from: TaskState, to: TaskState): boolean {
    return (ALLOWED[from] ?? []).includes(to);
  }

  transition(id: number, to: TaskState, detail = ''): CodingTask {
    const task = this.require(id);
    if (task.state === to) return task;
    if (!this.canTransition(task.state, to)) throw new TaskTransitionError(task.state, to);
    const now = new Date().toISOString();
    this.db.run('UPDATE coding_tasks SET state = ?, updated_at = ? WHERE id = ?', to, now, id);
    this.event(id, `state:${to}`, detail || `${task.state} -> ${to}`);
    return this.require(id);
  }

  /** Record the approved scope a task is allowed to act within. */
  setScope(id: number, scope: Record<string, unknown>): CodingTask {
    this.require(id);
    this.db.run('UPDATE coding_tasks SET scope = ?, updated_at = ? WHERE id = ?', JSON.stringify(scope), new Date().toISOString(), id);
    this.event(id, 'scope', JSON.stringify(scope).slice(0, 500));
    return this.require(id);
  }

  setPlan(id: number, plan: Record<string, unknown>): CodingTask {
    this.require(id);
    this.db.run('UPDATE coding_tasks SET plan = ?, updated_at = ? WHERE id = ?', JSON.stringify(plan), new Date().toISOString(), id);
    this.event(id, 'plan', JSON.stringify(plan).slice(0, 500));
    return this.require(id);
  }

  recordChange(id: number, change: Record<string, unknown>): CodingTask {
    const task = this.require(id);
    const changes = [...task.changes, change];
    this.db.run('UPDATE coding_tasks SET changes = ?, updated_at = ? WHERE id = ?', JSON.stringify(changes), new Date().toISOString(), id);
    this.event(id, 'change', JSON.stringify(change).slice(0, 400));
    return this.require(id);
  }

  recordTestResult(id: number, result: Record<string, unknown>): CodingTask {
    const task = this.require(id);
    const results = [...task.testResults, result];
    this.db.run('UPDATE coding_tasks SET test_results = ?, updated_at = ? WHERE id = ?', JSON.stringify(results), new Date().toISOString(), id);
    this.event(id, 'test', JSON.stringify(result).slice(0, 400));
    return this.require(id);
  }

  fail(id: number, error: string): CodingTask {
    this.require(id);
    this.db.run('UPDATE coding_tasks SET state = ?, error = ?, updated_at = ? WHERE id = ?', 'failed', error.slice(0, 1000), new Date().toISOString(), id);
    this.event(id, 'failed', error.slice(0, 300));
    return this.require(id);
  }

  /**
   * Cancellation stops executable work immediately. The record is kept so the
   * history shows what happened, but no state can leave 'cancelled'.
   */
  cancel(id: number, reason = ''): CodingTask {
    const task = this.require(id);
    if (TERMINAL_STATES.has(task.state)) return task;
    this.db.run('UPDATE coding_tasks SET state = ?, error = ?, updated_at = ? WHERE id = ?', 'cancelled', reason || 'cancelled by Karl', new Date().toISOString(), id);
    this.event(id, 'cancelled', reason);
    return this.require(id);
  }

  events(id: number, limit = 200): { at: string; kind: string; detail: string }[] {
    return this.db
      .all<{ at: string; kind: string; detail: string }>('SELECT at, kind, detail FROM task_events WHERE task_id = ? ORDER BY id LIMIT ?', id, limit)
      .map((row) => ({ at: row.at, kind: row.kind, detail: row.detail }));
  }

  /**
   * Startup recovery. Any task that was mid-flight is marked as needing
   * confirmation and is never returned in an executable state.
   */
  recoverOnStartup(): CodingTask[] {
    const now = new Date().toISOString();
    const recovered: CodingTask[] = [];
    for (const task of this.list(200)) {
      if (TERMINAL_STATES.has(task.state)) continue;
      if (task.requiresConfirm) continue;
      const recovery = {
        ...task.recovery,
        interruptedAtState: task.state,
        recoveredAt: now,
        note: 'The application restarted while this task was in progress. No work resumed.',
      };
      this.db.run(
        'UPDATE coding_tasks SET requires_confirm = 1, recovery = ?, updated_at = ? WHERE id = ?',
        JSON.stringify(recovery),
        now,
        task.id,
      );
      this.event(task.id, 'recovered', `interrupted in ${task.state}; awaiting confirmation`);
      recovered.push(this.require(task.id));
    }
    return recovered;
  }

  /** Karl explicitly resumes; only now may executable states be entered again. */
  confirmResume(id: number): CodingTask {
    const task = this.require(id);
    if (TERMINAL_STATES.has(task.state)) throw new Error('a finished task cannot be resumed');
    this.db.run('UPDATE coding_tasks SET requires_confirm = 0, updated_at = ? WHERE id = ?', new Date().toISOString(), id);
    this.event(id, 'resumed', 'Karl confirmed continuation');
    return this.require(id);
  }

  /** True only when a task may touch the filesystem or run commands right now. */
  mayExecute(task: CodingTask): boolean {
    return EXECUTABLE_STATES.has(task.state) && !task.requiresConfirm && !TERMINAL_STATES.has(task.state);
  }

  private event(id: number, kind: string, detail: string): void {
    this.db.run('INSERT INTO task_events(task_id, at, kind, detail) VALUES (?,?,?,?)', id, new Date().toISOString(), kind, detail.slice(0, 2000));
  }

  private require(id: number): CodingTask {
    const task = this.get(id);
    if (!task) throw new Error(`unknown task ${id}`);
    return task;
  }

  private lastId(): number {
    const row = this.db.get<{ id: number }>('SELECT last_insert_rowid() AS id');
    if (!row) throw new Error('could not read last insert id');
    return row.id;
  }
}

function toTask(row: Record<string, unknown>): CodingTask {
  const parse = (value: unknown): Record<string, unknown> => {
    try {
      return JSON.parse(value as string) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const parseList = (value: unknown): unknown[] => {
    try {
      return JSON.parse(value as string) as unknown[];
    } catch {
      return [];
    }
  };
  return {
    id: row.id as number,
    repo: row.repo as string,
    objective: row.objective as string,
    state: row.state as TaskState,
    model: row.model as string,
    plan: parse(row.plan),
    scope: parse(row.scope),
    changes: parseList(row.changes),
    testResults: parseList(row.test_results),
    error: (row.error as string) ?? null,
    recovery: parse(row.recovery),
    requiresConfirm: Boolean(row.requires_confirm),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}