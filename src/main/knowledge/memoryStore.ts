import type { AstraDatabase } from '../knowledge/database';

/**
 * Persistent memory with explicit provenance.
 *
 * This is retrieval of stored experience, not fine-tuning: Gemma's weights are
 * never changed. Nothing is written from ordinary conversation chatter - only
 * from Karl's explicit instruction, an explicit correction, or a recorded
 * technical decision. Website content can never become a memory.
 */

export type MemoryCategory =
  | 'project_fact'
  | 'preference'
  | 'correction'
  | 'successful_approach'
  | 'failed_approach'
  | 'decision'
  | 'development_note';

export type MemoryProvenance = 'karl_explicit' | 'correction' | 'task_outcome' | 'conversation';

export interface MemoryRecord {
  readonly id: number;
  readonly category: MemoryCategory;
  readonly statement: string;
  readonly provenance: MemoryProvenance;
  readonly confidence: number;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryStats {
  readonly total: number;
  readonly active: number;
  readonly byCategory: Readonly<Record<string, number>>;
}

export class MemoryStore {
  constructor(private readonly db: AstraDatabase) {}

  /**
   * Record a memory. Only trusted origins are accepted: Karl's explicit words
   * and recorded task outcomes. `conversation` is allowed for explicit user
   * statements but is lower confidence and never auto-promoted.
   */
  remember(input: {
    category: MemoryCategory;
    statement: string;
    provenance: MemoryProvenance;
    confidence?: number;
    origin?: 'karl' | 'task' | 'web';
  }): MemoryRecord {
    const statement = input.statement.trim();
    if (!statement) throw new Error('cannot store an empty memory');

    // Hard rule: nothing learned from a website becomes a trusted memory.
    if (input.origin === 'web') {
      throw new Error('website content must never be stored as memory');
    }
    const confidence = Math.min(1, Math.max(0, input.confidence ?? (input.provenance === 'conversation' ? 0.4 : 0.8)));
    const now = new Date().toISOString();

    const duplicate = this.db.get<{ id: number }>(
      'SELECT id FROM memory WHERE statement = ? AND category = ?',
      statement,
      input.category,
    );
    if (duplicate) return this.require(duplicate.id);

    this.db.run(
      'INSERT INTO memory(category, statement, provenance, confidence, active, created_at, updated_at) VALUES (?,?,?,?,1,?,?)',
      input.category, statement, input.provenance, confidence, now, now,
    );
    return this.require(lastId(this.db));
  }

  /**
   * Karl corrects Astra. The old statement is superseded, never silently
   * deleted, and the correction is recorded in its own right.
   */
  correct(originalStatement: string, correctedStatement: string, reason = ''): MemoryRecord {
    const corrected = correctedStatement.trim();
    if (!corrected) throw new Error('a correction must state the correct version');

    return this.db.transaction(() => {
      const existing = this.db.get<{ id: number }>('SELECT id FROM memory WHERE statement = ? AND active = 1', originalStatement);
      const now = new Date().toISOString();

      if (existing) {
        this.db.run('UPDATE memory SET active = 0, updated_at = ? WHERE id = ?', now, existing.id);
      }
      this.db.run(
        'INSERT INTO corrections(memory_id, original, corrected, reason, created_at) VALUES (?,?,?,?,?)',
        existing?.id ?? null, originalStatement, corrected, reason, now,
      );
      this.db.run(
        'INSERT INTO memory(category, statement, provenance, confidence, active, created_at, updated_at) VALUES (?,?,?,?,1,?,?)',
        'correction', corrected, 'correction', 1, now, now,
      );
      return this.require(lastId(this.db));
    });
  }

  /** Memories Astra should consider when answering, strongest first. */
  relevant(query: string, limit = 8): MemoryRecord[] {
    const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
    if (terms.length === 0) return this.active(limit);
    const scored = terms.map(() => 'lower(statement) LIKE ?');
    const params = terms.map((term) => `%${term}%`);
    return this.db
      .all<Record<string, unknown>>(
        `SELECT * FROM memory WHERE active = 1 AND (${scored.join(' OR ')}) ORDER BY confidence DESC, updated_at DESC LIMIT ?`,
        ...params,
        limit,
      )
      .map(toMemory);
  }

  active(limit = 100): MemoryRecord[] {
    return this.db
      .all<Record<string, unknown>>('SELECT * FROM memory WHERE active = 1 ORDER BY confidence DESC, updated_at DESC LIMIT ?', limit)
      .map(toMemory);
  }

  history(limit = 100): MemoryRecord[] {
    return this.db
      .all<Record<string, unknown>>('SELECT * FROM memory ORDER BY id DESC LIMIT ?', limit)
      .map(toMemory);
  }

  listCorrections(): { id: number; original: string; corrected: string; reason: string; createdAt: string }[] {
    return this.db.all<Record<string, unknown>>('SELECT * FROM corrections ORDER BY id DESC').map((row) => ({
      id: row.id as number,
      original: row.original as string,
      corrected: row.corrected as string,
      reason: row.reason as string,
      createdAt: row.created_at as string,
    }));
  }

  /** Deactivate a memory without destroying its history. */
  forget(id: number): void {
    this.db.run('UPDATE memory SET active = 0, updated_at = ? WHERE id = ?', new Date().toISOString(), id);
  }

  /** Permanently remove one memory and its correction links. */
  purge(id: number): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM corrections WHERE memory_id = ?', id);
      this.db.run('DELETE FROM memory WHERE id = ?', id);
    });
  }

  stats(): MemoryStats {
    const count = (sql: string): number => this.db.get<{ n: number }>(sql)?.n ?? 0;
    const total = count('SELECT count(*) AS n FROM memory');
    const active = count('SELECT count(*) AS n FROM memory WHERE active = 1');
    const byCategory: Record<string, number> = {};
    for (const row of this.db.all<{ category: string; n: number }>('SELECT category, count(*) AS n FROM memory GROUP BY category')) {
      byCategory[row.category] = row.n;
    }
    return { total, active, byCategory };
  }

  private require(id: number): MemoryRecord {
    const row = this.db.get<{ id: number }>('SELECT * FROM memory WHERE id = ?', id);
    if (!row) throw new Error(`unknown memory ${id}`);
    return toMemory(row);
  }
}

/** SQLite reports the id of the last insert through a query, not a return value. */
function lastId(db: AstraDatabase): number {
  const row = db.get<{ id: number }>('SELECT last_insert_rowid() AS id');
  if (!row) throw new Error('could not read the last insert id');
  return row.id;
}

function toMemory(row: Record<string, unknown>): MemoryRecord {
  return {
    id: row.id as number,
    category: row.category as MemoryCategory,
    statement: row.statement as string,
    provenance: row.provenance as MemoryProvenance,
    confidence: row.confidence as number,
    active: Boolean(row.active),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}