/**
 * Versioned schema migrations for Astra's local intelligence database.
 *
 * Rules for this file:
 *  - Migrations are append-only. Never edit a migration that has shipped; add
 *    a new one instead, or a restored backup will diverge from the code.
 *  - Every migration must be safe to run exactly once and inside a transaction.
 *  - Nothing here may reference a user file path: the database lives outside
 *    the tracked source tree and must never be created inside the repository.
 */

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial intelligence schema',
    statements: [
      `CREATE TABLE sources (
        id             INTEGER PRIMARY KEY,
        url            TEXT NOT NULL UNIQUE,
        host           TEXT NOT NULL,
        label          TEXT NOT NULL DEFAULT '',
        approved       INTEGER NOT NULL DEFAULT 1,
        status         TEXT NOT NULL DEFAULT 'approved',
        max_pages      INTEGER NOT NULL DEFAULT 5,
        max_depth      INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL,
        last_refresh_at TEXT,
        last_error     TEXT,
        note           TEXT
      )`,
      `CREATE TABLE documents (
        id            INTEGER PRIMARY KEY,
        source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        url           TEXT NOT NULL,
        title         TEXT NOT NULL DEFAULT '',
        content_hash  TEXT NOT NULL,
        bytes         INTEGER NOT NULL DEFAULT 0,
        content_type  TEXT NOT NULL DEFAULT '',
        etag          TEXT,
        last_modified TEXT,
        published_at  TEXT,
        updated_at    TEXT,
        fetched_at    TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'stored',
        error         TEXT
      )`,
      `CREATE UNIQUE INDEX documents_url_unique ON documents(url)`,
      `CREATE TABLE chunks (
        id          INTEGER PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        ordinal     INTEGER NOT NULL,
        text        TEXT NOT NULL,
        UNIQUE(document_id, ordinal)
      )`,
      // External-content FTS table: the chunk text stays in `chunks` only.
      `CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id', tokenize='unicode61')`,
      `CREATE TABLE memory (
        id           INTEGER PRIMARY KEY,
        category     TEXT NOT NULL,
        statement    TEXT NOT NULL,
        provenance   TEXT NOT NULL DEFAULT 'conversation',
        confidence   REAL NOT NULL DEFAULT 0.6,
        active       INTEGER NOT NULL DEFAULT 1,
        superseded_by INTEGER,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      )`,
      `CREATE INDEX memory_active_idx ON memory(active, category)`,
      `CREATE TABLE corrections (
        id         INTEGER PRIMARY KEY,
        memory_id  INTEGER REFERENCES memory(id) ON DELETE CASCADE,
        original   TEXT NOT NULL,
        corrected  TEXT NOT NULL,
        reason     TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE projects (
        id            INTEGER PRIMARY KEY,
        name          TEXT NOT NULL,
        root          TEXT NOT NULL UNIQUE,
        description   TEXT NOT NULL DEFAULT '',
        languages     TEXT NOT NULL DEFAULT '[]',
        frameworks    TEXT NOT NULL DEFAULT '[]',
        test_commands TEXT NOT NULL DEFAULT '[]',
        indexed_at    TEXT NOT NULL
      )`,
      `CREATE TABLE coding_tasks (
        id             INTEGER PRIMARY KEY,
        repo           TEXT NOT NULL,
        objective      TEXT NOT NULL,
        state          TEXT NOT NULL,
        model          TEXT NOT NULL DEFAULT '',
        plan           TEXT NOT NULL DEFAULT '{}',
        scope          TEXT NOT NULL DEFAULT '{}',
        changes        TEXT NOT NULL DEFAULT '[]',
        test_results   TEXT NOT NULL DEFAULT '[]',
        error          TEXT,
        recovery       TEXT NOT NULL DEFAULT '{}',
        requires_confirm INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      )`,
      `CREATE TABLE task_events (
        id      INTEGER PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES coding_tasks(id) ON DELETE CASCADE,
        at      TEXT NOT NULL,
        kind    TEXT NOT NULL,
        detail  TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE INDEX task_events_task_idx ON task_events(task_id, id)`,
      `CREATE TABLE approvals (
        id          INTEGER PRIMARY KEY,
        task_id     INTEGER REFERENCES coding_tasks(id) ON DELETE CASCADE,
        level       TEXT NOT NULL,
        action      TEXT NOT NULL,
        scope       TEXT NOT NULL DEFAULT '{}',
        risk        TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'pending',
        created_at  TEXT NOT NULL,
        decided_at  TEXT,
        note        TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE TABLE audit (
        id      INTEGER PRIMARY KEY,
        at      TEXT NOT NULL,
        actor   TEXT NOT NULL,
        action  TEXT NOT NULL,
        target  TEXT NOT NULL DEFAULT '',
        result  TEXT NOT NULL DEFAULT 'ok',
        detail  TEXT NOT NULL DEFAULT '{}'
      )`,
      `CREATE INDEX audit_at_idx ON audit(id DESC)`,
    ],
  },
  {
    version: 2,
    name: 'knowledge refresh and citation support',
    statements: [
      // Tracked separately so a failed re-fetch never destroys what we can
      // still answer from.
      `ALTER TABLE documents ADD COLUMN stale INTEGER NOT NULL DEFAULT 0`,
      `CREATE TABLE citations (
        id          INTEGER PRIMARY KEY,
        source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        url         TEXT NOT NULL,
        title       TEXT NOT NULL DEFAULT '',
        fetched_at  TEXT NOT NULL
      )`,
    ],
  },
{
    version: 3,
    name: 'personal memory status, provenance and settings',
    statements: [
      // Personal memory V1 extends the existing memory table rather than
      // creating a second, incompatible store. `active` stays authoritative
      // for retrieval; `status` is the readable lifecycle label and is written
      // together with it so the two can never disagree.
      `ALTER TABLE memory ADD COLUMN subject TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE memory ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
      `ALTER TABLE memory ADD COLUMN origin TEXT NOT NULL DEFAULT 'user_stated'`,
      `ALTER TABLE memory ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'normal'`,
      `ALTER TABLE memory ADD COLUMN conversation_ref TEXT`,
      `ALTER TABLE memory ADD COLUMN forgotten_at TEXT`,
      `ALTER TABLE memory ADD COLUMN superseded_reason TEXT`,
      `CREATE INDEX memory_subject_idx ON memory(subject, active)`,
      // Every lifecycle change is auditable, so a forgotten memory can be
      // explained and a stale cache can be detected by revision.
      `CREATE TABLE memory_events (
        id        INTEGER PRIMARY KEY,
        memory_id INTEGER REFERENCES memory(id) ON DELETE CASCADE,
        at        TEXT NOT NULL,
        kind      TEXT NOT NULL,
        detail    TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;