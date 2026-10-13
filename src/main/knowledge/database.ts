import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS, type Migration } from './schema';

/**
 * Astra's local intelligence database.
 *
 * Uses the SQLite build bundled with Node (`node:sqlite`) so the project gains
 * a real database without adding a native dependency or shipping a cloud
 * service. The file lives in the Electron user-data directory, never in the
 * repository.
 */

export class AstraDatabase {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private closed = false;

  constructor(readonly filePath: string) {
    if (filePath !== ':memory:') mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    try {
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA foreign_keys = ON');
      this.db.exec('PRAGMA busy_timeout = 5000');
    } catch (error) {
      // A corrupt file can fail on the very first pragma. Release the handle
      // before propagating, otherwise the damaged file stays locked and cannot
      // be inspected or replaced.
      this.closed = true;
      try {
        this.db.close();
      } catch {
        // Nothing useful to do; the original error is what matters.
      }
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('database is closed');
  }

  /** Prepared-statement cache; statements are reused across calls. */
  prepare(sql: string): StatementSync {
    this.assertOpen();
    const cached = this.statements.get(sql);
    if (cached) return cached;
    const statement = this.db.prepare(sql);
    this.statements.set(sql, statement);
    return statement;
  }

  run(sql: string, ...params: readonly unknown[]): void {
    this.prepare(sql).run(...(params as never[]));
  }

  get<T = Record<string, unknown>>(sql: string, ...params: readonly unknown[]): T | undefined {
    return this.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, ...params: readonly unknown[]): T[] {
    return this.prepare(sql).all(...(params as never[])) as T[];
  }

  exec(sql: string): void {
    this.assertOpen();
    this.db.exec(sql);
  }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Apply every migration that has not run yet. Safe to call on every start:
   * already-applied versions are skipped inside a transaction.
   */
  migrate(migrations: readonly Migration[] = MIGRATIONS): number[] {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);
    const applied = new Set(this.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version));
    const performed: number[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      this.transaction(() => {
        for (const statement of migration.statements) this.db.exec(statement);
        this.db
          .prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?,?,?)')
          .run(migration.version, migration.name, new Date().toISOString());
      });
      performed.push(migration.version);
    }
    return performed;
  }

  currentVersion(): number {
    const row = this.get<{ version: number }>('SELECT MAX(version) AS version FROM schema_migrations');
    return row?.version ?? 0;
  }

  /** Consistent on-disk copy using SQLite's own backup, not a file copy. */
  backup(destination: string): void {
    mkdirSync(path.dirname(destination), { recursive: true });
    this.db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.statements.clear();
    try {
      this.db.close();
    } catch {
      // Closing twice, or closing an already-broken handle, is not an error
      // worth surfacing to the caller.
    }
  }
}

/**
 * Open the database, migrate it, and recover from a corrupt file.
 *
 * Recovery is deliberately conservative: the damaged file is kept beside the
 * new one as `<name>.corrupt-<timestamp>` so nothing is destroyed, and the
 * replacement is empty rather than silently half-populated.
 */
export function openDatabase(filePath: string, migrations: readonly Migration[] = MIGRATIONS): {
  db: AstraDatabase;
  recovered: boolean;
  recoveredFrom?: string;
} {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const attempt = (): AstraDatabase => {
    const db = new AstraDatabase(filePath);
    try {
      db.migrate(migrations);
      // Touch every table so a truncated or malformed page is detected here
      // rather than during a user's query.
      db.exec('SELECT count(*) FROM sources');
      db.exec('SELECT count(*) FROM chunks_fts');
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  };

  try {
    return { db: attempt(), recovered: false };
  } catch (error) {
    if (!existsSync(filePath)) throw error;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantine = `${filePath}.corrupt-${stamp}`;
    try {
      copyFileSync(filePath, quarantine);
      // Only clear the original once a copy exists, so a failure here can
      // never destroy the only remaining copy of Karl's data.
      for (const sidecar of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
        rmSync(sidecar, { force: true });
      }
    } catch {
      throw error;
    }
    return { db: attempt(), recovered: true, recoveredFrom: quarantine };
  }
}