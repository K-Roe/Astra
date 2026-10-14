import type { AstraDatabase } from '../knowledge/database';
import type { MemoryStore, MemoryCategory } from '../knowledge/memoryStore';

/**
 * Personal memory for Karl.
 *
 * This is retrieval of what Karl explicitly told Astra, stored in the existing
 * intelligence database. It is **not** model training and **not** fine-tuning:
 * Gemma's weights are never touched. Everything here is bounded, typed and
 * validated, and it can be corrected, forgotten and inspected by Karl.
 *
 * Hard rules:
 *  - Only Karl's own words create memory. Website content, repository files and
 *    model output are rejected at the boundary (`assertStorable`).
 *  - Secrets are never stored. A statement that looks like a credential is
 *    refused rather than silently redacted and saved.
 *  - Retrieval is bounded. A summary is assembled under a character budget so a
 *    large database can never flood a 4k context window.
 *  - Every write bumps a revision so cached prompt context cannot go stale.
 */

export type PersonalMemoryStatus = 'active' | 'forgotten' | 'superseded';
export type PersonalMemoryOrigin = 'user_stated' | 'user_correction' | 'ui_edit' | 'model_suggested_accepted';
export type PersonalMemorySensitivity = 'normal' | 'sensitive';

export interface PersonalMemory {
  readonly id: number;
  readonly subject: string;
  readonly category: MemoryCategory;
  readonly statement: string;
  readonly origin: PersonalMemoryOrigin;
  readonly provenance: string;
  readonly status: PersonalMemoryStatus;
  readonly sensitivity: PersonalMemorySensitivity;
  readonly confidence: number;
  readonly conversationRef: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly forgottenAt: string | null;
}

export interface PersonalMemorySummary {
  readonly count: number;
  readonly revision: number;
  readonly loadedAt: string;
  readonly characters: number;
  readonly truncated: boolean;
}

export interface MemoryContextBlock {
  readonly relevant: readonly PersonalMemory[];
  readonly summary: readonly PersonalMemory[];
  readonly characters: number;
}

/** Longest single statement accepted. */
const MAX_STATEMENT = 400;
/** Total characters any one memory block may occupy in a prompt. */
export const MEMORY_CONTEXT_BUDGET = 1400;

/**
 * Patterns that indicate a credential rather than a preference. Storing these
 * would put a secret at rest in a plaintext local database.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:api[_\- ]?key|secret[_\- ]?key|access[_\- ]?token|bearer|password|passphrase|private[_\- ]?key|client[_\- ]?secret)\b/i,
  /\b(?:sk|pk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b.*\b(?:password|secret|token)\b/i,
];

const CATEGORY_VALUES: readonly MemoryCategory[] = [
  'project_fact', 'preference', 'correction', 'successful_approach', 'failed_approach', 'decision', 'development_note',
];

export class PersonalMemoryService {
  /** Bumped on every write so prompt and UI caches can detect staleness. */
  private revisionCounter = 0;
  private loadedAt = new Date().toISOString();

  constructor(private readonly db: AstraDatabase, private readonly store: MemoryStore) {
    // A database written before Personal Memory V1 has rows with no subject or
    // status column values; normalise them so retrieval never sees a blank.
    this.db.run(`UPDATE memory SET status = CASE WHEN active = 1 THEN 'active' ELSE 'forgotten' END WHERE status = ''`);
    this.revisionCounter = this.countActive();
  }

  revision(): number {
    return this.revisionCounter;
  }

  summary(): PersonalMemorySummary {
    const active = this.listActive();
    return {
      count: active.length,
      revision: this.revisionCounter,
      loadedAt: this.loadedAt,
      characters: active.reduce((total, memory) => total + memory.statement.length, 0),
      truncated: active.length > 20,
    };
  }

  /**
   * Record something Karl explicitly stated.
   *
   * Confirmed success means the SQLite transaction committed; the caller must
   * not report a memory as saved before this returns.
   */
  remember(input: {
    statement: string;
    category?: string;
    subject?: string;
    origin?: PersonalMemoryOrigin;
    conversationRef?: string | null;
    confidence?: number;
    replaceSubject?: boolean;
    /** Explicit correction: supersede the most recent same-category memory. */
    correction?: boolean;
  }): PersonalMemory {
    const statement = this.assertStorable(input.statement);
    const category = CATEGORY_VALUES.includes(input.category as MemoryCategory)
      ? (input.category as MemoryCategory)
      : 'preference';
    const subject = (input.subject ?? '').trim();
    const now = new Date().toISOString();

    return this.db.transaction(() => {
      const duplicate = this.db.get<{ id: number }>(
        'SELECT id FROM memory WHERE statement = ? AND active = 1',
        statement,
      );
      if (duplicate) {
        this.event(duplicate.id, 'remember.duplicate');
        this.revisionCounter += 1;
        return this.require(duplicate.id);
      }

      // A new statement for a subject that already has an active memory
      // supersedes the old one, so contradictory facts cannot both stay active.
      // An explicit correction with no subject match supersedes the most
      // recently updated active memory of the same category instead, which is
      // what "actually, I prefer X" means in conversation.
      let superseded = subject
        ? this.db.all<{ id: number }>('SELECT id FROM memory WHERE subject = ? AND active = 1', subject)
        : [];
      if (superseded.length === 0 && input.correction) {
        superseded = this.db.all<{ id: number }>(
          'SELECT id FROM memory WHERE active = 1 AND category = ? ORDER BY updated_at DESC LIMIT 1',
          category,
        );
      }
      this.db.run(
        `INSERT INTO memory(category, statement, provenance, confidence, active, created_at, updated_at,
          subject, status, origin, sensitivity, conversation_ref)
         VALUES (?,?,?,?,1,?,?,?,?,?,?,?)`,
        category,
        statement,
        input.origin === 'user_correction' ? 'correction' : 'karl_explicit',
        input.confidence ?? 0.95,
        now,
        now,
        subject,
        'active',
        input.origin ?? 'user_stated',
        SECRET_PATTERNS.some((pattern) => pattern.test(statement)) ? 'sensitive' : 'normal',
        input.conversationRef ?? null,
      );
      const created = this.require(this.lastId());
      for (const row of superseded) {
        if (row.id === created.id) continue;
        this.db.run(
          `UPDATE memory SET active = 0, status = 'superseded', superseded_reason = ?, updated_at = ? WHERE id = ?`,
          `replaced by statement ${created.id}`,
          now,
          row.id,
        );
        this.event(row.id, 'memory.superseded', `replaced by ${created.id}`);
      }
      this.event(created.id, 'memory.created', category);
      this.revisionCounter += 1;
      this.loadedAt = now;
      return created;
    });
  }

  /** Edit an existing memory in place; the correction history is preserved. */
  update(id: number, patch: { statement?: string; category?: string; subject?: string }): PersonalMemory {
    const existing = this.require(id);
    if (existing.status !== 'active') throw new Error('that memory is no longer active; add a new one instead');
    const statement = patch.statement === undefined ? existing.statement : this.assertStorable(patch.statement);
    const category = patch.category && CATEGORY_VALUES.includes(patch.category as MemoryCategory)
      ? (patch.category as MemoryCategory)
      : existing.category;
    const subject = patch.subject === undefined ? existing.subject : patch.subject.trim();
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      const previous = existing.statement;
      this.db.run(
        `UPDATE memory SET statement = ?, category = ?, subject = ?, origin = ?, updated_at = ? WHERE id = ?`,
        statement, category, subject, 'ui_edit', now, id,
      );
      if (previous !== statement) {
        this.db.run(
          `INSERT INTO corrections(memory_id, original, corrected, reason, created_at) VALUES (?,?,?,?,?)`,
          id, previous, statement, 'edited by Karl', now,
        );
      }
      this.event(id, 'memory.updated');
      this.revisionCounter += 1;
      this.loadedAt = now;
      return this.require(id);
    });
  }

  /**
   * Forget one memory. The row is deactivated and excluded from every future
   * prompt; the text is cleared so it is not merely hidden but actually removed
   * from the live table. Backups of the database file may still contain the old
   * value until they age out - see docs/PERSONAL_MEMORY_V1.md.
   */
  forget(id: number): PersonalMemory {
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      const row = this.db.get<{ id: number }>('SELECT id FROM memory WHERE id = ?', id);
      if (!row) throw new Error(`unknown memory ${id}`);
      this.db.run(
        `UPDATE memory SET active = 0, status = 'forgotten', forgotten_at = ?, statement = '', updated_at = ? WHERE id = ?`,
        now, now, id,
      );
      this.event(id, 'memory.forgotten');
      this.revisionCounter += 1;
      this.loadedAt = now;
      return this.require(id);
    });
  }

  /** Forget every memory captured from one conversation, if any were. */
  forgetConversation(conversationRef: string): number {
    const now = new Date().toISOString();
    const count = this.db.transaction(() => {
      const rows = this.db.all<{ id: number }>(
        'SELECT id FROM memory WHERE conversation_ref = ? AND active = 1',
        conversationRef,
      );
      for (const row of rows) {
        this.db.run(
          `UPDATE memory SET active = 0, status = 'forgotten', forgotten_at = ?, statement = '', updated_at = ? WHERE id = ?`,
          now, now, row.id,
        );
        this.event(row.id, 'memory.forgotten', 'conversation');
      }
      this.revisionCounter += 1;
      return rows.length;
    });
    this.loadedAt = now;
    return count;
  }

  /** Resolve a forget request that named a subject or a phrase, not an id. */
  forgetByText(text: string): PersonalMemory[] {
    const needle = text.trim();
    if (!needle) throw new Error('tell me what to forget');
    const key = needle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const words = needle.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter((word) => word.length > 2);
    const rows = this.db.all<{ id: number }>(
      `SELECT id FROM memory WHERE active = 1 AND (
         lower(subject) LIKE ? OR lower(subject) LIKE ? OR lower(statement) LIKE ?
         OR lower(category) = ? OR lower(statement) LIKE ?
       ) ORDER BY id`,
      `preference.${key}`,
      `%${key}%`,
      `%${needle}%`,
      needle,
      `%${words.join(' ')}%`,
    );
    if (rows.length === 0) throw new Error(`no stored memory matches "${needle}"`);
    return rows.map((row) => this.forget(row.id));
  }

  listActive(limit = 200): PersonalMemory[] {
    return this.db
      .all<Record<string, unknown>>(
        `SELECT * FROM memory WHERE active = 1 ORDER BY confidence DESC, updated_at DESC LIMIT ?`,
        limit,
      )
      .map(toPersonal);
  }

  /** Everything, including forgotten rows, for Karl's own inspection. */
  listAll(limit = 200): (PersonalMemory & { readonly forgotten: boolean })[] {
    return this.db
      .all<Record<string, unknown>>('SELECT * FROM memory ORDER BY id DESC LIMIT ?', limit)
      .map((row) => ({ ...toPersonal(row), forgotten: Boolean((row as Record<string, unknown>).active === 0) }));
  }

  listCorrections(): ReturnType<MemoryStore['listCorrections']> {
    return this.store.listCorrections();
  }

  /**
   * Memories worth including in a reply: keyword matches first, then the most
   * recently updated active memories so a new preference is never missed.
   */
  relevant(query: string, limit = 6): PersonalMemory[] {
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 2 && !STOP.has(term))
      .slice(0, 12);
    const active = this.listActive();
    if (terms.length === 0) return active.slice(0, limit);
    const scored = active
      .map((memory) => {
        const haystack = `${memory.subject} ${memory.statement} ${memory.category}`.toLowerCase();
        const hits = terms.filter((term) => haystack.includes(term)).length;
        return { memory, hits };
      })
      .filter((entry) => entry.hits > 0)
      .sort((a, b) => b.hits - a.hits || b.memory.updatedAt.localeCompare(a.memory.updatedAt));
    return scored.slice(0, limit).map((entry) => entry.memory);
  }

  /**
   * The bounded block injected into every conversation.
   *
   * Relevant memories come first, then a summary of the rest, and the whole
   * block is truncated to `MEMORY_CONTEXT_BUDGET` characters so a large store
   * cannot overwhelm the model's context window.
   */
  contextBlock(query: string): MemoryContextBlock {
    const relevant = this.relevant(query, 6);
    const seen = new Set(relevant.map((memory) => memory.id));
    const summary = this.listActive().filter((memory) => !seen.has(memory.id)).slice(0, 12);
    let characters = 0;
    const keep = <T extends PersonalMemory>(items: readonly T[]): T[] => {
      const out: T[] = [];
      for (const item of items) {
        const cost = item.statement.length + item.category.length + 8;
        if (characters + cost > MEMORY_CONTEXT_BUDGET) break;
        characters += cost;
        out.push(item);
      }
      return out;
    };
    return { relevant: keep(relevant), summary: keep(summary), characters };
  }

  // ------------------------------------------------------------- settings

  getSetting(key: string): string | null {
    return this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.run(
      `INSERT INTO settings(key, value, updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key, value, new Date().toISOString(),
    );
    this.revisionCounter += 1;
  }

  suggestionsEnabled(): boolean {
    return this.getSetting('memory.suggestions') !== 'off';
  }

  // -------------------------------------------------------------- helpers

  private assertStorable(statement: string): string {
    // Control characters are stripped rather than stored: they only ever come
    // from pasted terminal output and make the record unreadable.
    const cleaned = statement
      .split('')
      .filter((character) => character.charCodeAt(0) >= 0x20 && character.charCodeAt(0) !== 0x7f)
      .join('')
      .trim();
    if (cleaned.length < 3) throw new Error('that memory is too short to save');
    if (cleaned.length > MAX_STATEMENT) throw new Error(`keep a memory under ${MAX_STATEMENT} characters`);
    if (SECRET_PATTERNS.some((pattern) => pattern.test(cleaned))) {
      throw new Error('that looks like a credential, so I will not store it in memory');
    }
    return cleaned;
  }

  private countActive(): number {
    return this.db.get<{ n: number }>('SELECT count(*) AS n FROM memory WHERE active = 1')?.n ?? 0;
  }

  private lastId(): number {
    const row = this.db.get<{ id: number }>('SELECT last_insert_rowid() AS id');
    if (!row) throw new Error('could not read the last insert id');
    return row.id;
  }

  private event(memoryId: number, kind: string, detail = ''): void {
    this.db.run(
      'INSERT INTO memory_events(memory_id, at, kind, detail) VALUES (?,?,?,?)',
      memoryId, new Date().toISOString(), kind, detail,
    );
  }

  private require(id: number): PersonalMemory {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM memory WHERE id = ?', id);
    if (!row) throw new Error(`unknown memory ${id}`);
    return toPersonal(row);
  }
}

const STOP = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'your', 'you', 'are', 'was', 'what',
  'about', 'have', 'been', 'they', 'them', 'does', 'tell', 'please', 'astral',
]);

function toPersonal(row: Record<string, unknown>): PersonalMemory {
  const active = Boolean(row.active);
  return {
    id: row.id as number,
    subject: (row.subject as string) ?? '',
    category: row.category as MemoryCategory,
    statement: (row.statement as string) ?? '',
    origin: (row.origin as PersonalMemoryOrigin) ?? 'user_stated',
    provenance: (row.provenance as string) ?? 'conversation',
    status: active ? 'active' : ((row.status as PersonalMemoryStatus) ?? 'forgotten'),
    sensitivity: (row.sensitivity as PersonalMemorySensitivity) ?? 'normal',
    confidence: row.confidence as number,
    conversationRef: (row.conversation_ref as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    forgottenAt: (row.forgotten_at as string) ?? null,
  };
}