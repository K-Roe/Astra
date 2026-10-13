import type { AstraDatabase } from '../knowledge/database';

/**
 * Approvals and audit.
 *
 * Every privileged action needs an approval recorded here first. Approvals are
 * bound to a scope; if a task's scope changes materially the old approval no
 * longer applies and a new one must be requested. Silence is never approval,
 * and the audit log records refusals as well as actions.
 */

export type ApprovalLevel = 'read_only' | 'task_approval' | 'separate_approval' | 'forbidden';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
  readonly id: number;
  readonly taskId: number | null;
  readonly level: ApprovalLevel;
  readonly action: string;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly risk: string;
  readonly status: ApprovalStatus;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly note: string;
}

export interface AuditEntry {
  readonly id: number;
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly result: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

/** Actions that are refused unconditionally, whatever an approval says. */
export const FORBIDDEN_ACTIONS: ReadonlySet<string> = new Set([
  'credential.read',
  'credential.use',
  'security.disable',
  'command.from_web_content',
  'file.write_outside_root',
  'self_grant_permission',
  'system.delete',
  'disk.format',
  'shell.interactive',
]);

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

export interface ApprovalManagerOptions {
  readonly now?: () => Date;
}

export class ApprovalManager {
  private readonly now: () => Date;

  constructor(private readonly db: AstraDatabase, options: ApprovalManagerOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  // ------------------------------------------------------------ approvals

  request(input: {
    level: ApprovalLevel;
    action: string;
    scope?: Record<string, unknown>;
    risk?: string;
    taskId?: number | null;
  }): ApprovalRequest {
    if (input.level === 'forbidden' || FORBIDDEN_ACTIONS.has(input.action)) {
      throw new PermissionError(`action "${input.action}" is never permitted`);
    }
    this.db.run(
      'INSERT INTO approvals(task_id, level, action, scope, risk, status, created_at) VALUES (?,?,?,?,?,?,?)',
      input.taskId ?? null,
      input.level,
      input.action,
      JSON.stringify(input.scope ?? {}),
      input.risk ?? '',
      'pending',
      this.now().toISOString(),
    );
    return this.require(lastId(this.db));
  }

  approve(id: number, note = ''): ApprovalRequest {
    this.db.run("UPDATE approvals SET status = 'approved', decided_at = ?, note = ? WHERE id = ? AND status = 'pending'", this.now().toISOString(), note, id);
    return this.require(id);
  }

  deny(id: number, note = ''): ApprovalRequest {
    this.db.run("UPDATE approvals SET status = 'denied', decided_at = ?, note = ? WHERE id = ? AND status = 'pending'", this.now().toISOString(), note, id);
    return this.require(id);
  }

  get(id: number): ApprovalRequest | undefined {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM approvals WHERE id = ?', id);
    return row ? toApproval(row) : undefined;
  }

  list(taskId?: number): ApprovalRequest[] {
    const rows = taskId
      ? this.db.all<Record<string, unknown>>('SELECT * FROM approvals WHERE task_id = ? ORDER BY id DESC', taskId)
      : this.db.all<Record<string, unknown>>('SELECT * FROM approvals ORDER BY id DESC LIMIT 200');
    return rows.map(toApproval);
  }

  pending(): ApprovalRequest[] {
    return this.list().filter((a) => a.status === 'pending');
  }

  /**
   * Assert that an approved, unexpired approval exists for this action and that
   * the scope still covers what is about to happen. Called immediately before
   * any privileged operation, never at plan time alone.
   */
  assertApproved(action: string, scope: Record<string, unknown> = {}): ApprovalRequest {
    if (FORBIDDEN_ACTIONS.has(action)) {
      throw new PermissionError(`action "${action}" is never permitted`);
    }
    const candidates = this.list().filter((a) => a.action === action && a.status === 'approved');
    if (candidates.length === 0) {
      throw new PermissionError(`no approval for "${action}"; request Karl's approval first`);
    }
    const match = candidates.find((a) => scopeMatches(a.scope, scope));
    if (!match) {
      throw new PermissionError(`the approved scope for "${action}" does not cover ${JSON.stringify(scope)}`);
    }
    return match;
  }

  // ---------------------------------------------------------------- audit

  record(entry: {
    actor: 'karl' | 'astra' | 'system' | 'web_content';
    action: string;
    target?: string;
    result?: string;
    detail?: Record<string, unknown>;
  }): AuditEntry {
    this.db.run(
      'INSERT INTO audit(at, actor, action, target, result, detail) VALUES (?,?,?,?,?,?)',
      this.now().toISOString(),
      entry.actor,
      entry.action,
      entry.target ?? '',
      entry.result ?? 'ok',
      JSON.stringify(entry.detail ?? {}),
    );
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM audit ORDER BY id DESC LIMIT 1');
    return toAudit(row as Record<string, unknown>);
  }

  audit(limit = 200, action?: string): AuditEntry[] {
    const rows = action
      ? this.db.all<Record<string, unknown>>('SELECT * FROM audit WHERE action = ? ORDER BY id DESC LIMIT ?', action, limit)
      : this.db.all<Record<string, unknown>>('SELECT * FROM audit ORDER BY id DESC LIMIT ?', limit);
    return rows.map(toAudit);
  }

  private require(id: number): ApprovalRequest {
    const approval = this.get(id);
    if (!approval) throw new Error(`unknown approval ${id}`);
    return approval;
  }
}

/**
 * A scope check, not a string comparison: every declared key in the approval
 * must be present and equal in the request. Extra request keys are ignored,
 * because the approval is the ceiling, not the floor.
 */
export function scopeMatches(approved: Readonly<Record<string, unknown>>, requested: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(approved)) {
    if (value === undefined || value === null) continue;
    const want = requested[key];
    if (want === undefined) return false;
    if (Array.isArray(value)) {
      if (!Array.isArray(want) || !value.every((item) => want.includes(item))) return false;
      continue;
    }
    if (typeof value === 'object') {
      if (typeof want !== 'object' || want === null) return false;
      if (!scopeMatches(value as Record<string, unknown>, want as Record<string, unknown>)) return false;
      continue;
    }
    if (value !== want) return false;
  }
  return true;
}

function lastId(db: AstraDatabase): number {
  const row = db.get<{ id: number }>('SELECT last_insert_rowid() AS id');
  if (!row) throw new Error('could not read the last insert id');
  return row.id;
}

function toApproval(row: Record<string, unknown>): ApprovalRequest {
  return {
    id: row.id as number,
    taskId: (row.task_id as number) ?? null,
    level: row.level as ApprovalLevel,
    action: row.action as string,
    scope: parseJson(row.scope),
    risk: row.risk as string,
    status: row.status as ApprovalStatus,
    createdAt: row.created_at as string,
    decidedAt: (row.decided_at as string) ?? null,
    note: row.note as string,
  };
}

/** Stored JSON must never be able to crash the renderer. */
function parseJson(value: unknown): Record<string, unknown> {
  try {
    return JSON.parse(value as string) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toAudit(row: Record<string, unknown>): AuditEntry {
  return {
    id: row.id as number,
    at: row.at as string,
    actor: row.actor as AuditEntry['actor'],
    action: row.action as string,
    target: row.target as string,
    result: row.result as string,
    detail: parseJson(row.detail),
  };
}