import { createHash } from 'node:crypto';
import type { AstraDatabase } from '../knowledge/database';
import { chunkText } from '../research/extraction';
import type { ApprovedSourceBoundary } from '../research/urlGuard';

/**
 * Knowledge storage and retrieval.
 *
 * Retrieval is SQLite FTS5 over stored chunks. Every returned passage carries
 * the document it came from so Astra can cite a real URL, and callers are told
 * how stale the source is. There is no vector database and no cloud service.
 */

export interface SourceRecord {
  readonly id: number;
  readonly url: string;
  readonly host: string;
  readonly label: string;
  readonly approved: boolean;
  readonly status: string;
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly createdAt: string;
  readonly lastRefreshAt: string | null;
  readonly lastError: string | null;
}

export interface RetrievedPassage {
  readonly chunkId: number;
  readonly text: string;
  readonly documentUrl: string;
  readonly documentTitle: string;
  readonly sourceId: number;
  readonly sourceLabel: string;
  readonly fetchedAt: string;
  readonly stale: boolean;
}

export interface StoredDocument {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly contentHash: string;
  readonly bytes: number;
  readonly fetchedAt: string;
  readonly stale: boolean;
}

export class KnowledgeStore {
  constructor(private readonly db: AstraDatabase) {}

  // ------------------------------------------------------------- sources

  addSource(input: { url: string; host: string; label?: string; maxPages?: number; maxDepth?: number; pathPrefix?: string }): SourceRecord {
    const existing = this.getSourceByUrl(input.url);
    if (existing) {
      this.db.run(
        'UPDATE sources SET label = ?, max_pages = ?, max_depth = ?, status = ?, note = ? WHERE id = ?',
        input.label ?? existing.label,
        input.maxPages ?? existing.maxPages,
        input.maxDepth ?? existing.maxDepth,
        'approved',
        input.pathPrefix ?? '/',
        existing.id,
      );
      return this.requireSource(existing.id);
    }
    this.db.run(
      `INSERT INTO sources(url, host, label, approved, status, max_pages, max_depth, created_at, note)
       VALUES (?,?,?,1,'approved',?,?,?,?)`,
      input.url,
      input.host,
      input.label ?? '',
      input.maxPages ?? 5,
      input.maxDepth ?? 1,
      new Date().toISOString(),
      input.pathPrefix ?? '/',
    );
    return this.requireSource(this.lastInsertId('sources'));
  }

  getSourceByUrl(url: string): SourceRecord | undefined {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM sources WHERE url = ?', url);
    return row ? toSource(row) : undefined;
  }

  getSource(id: number): SourceRecord | undefined {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM sources WHERE id = ?', id);
    return row ? toSource(row) : undefined;
  }

  listSources(): SourceRecord[] {
    return this.db.all<Record<string, unknown>>('SELECT * FROM sources ORDER BY created_at').map(toSource);
  }

  /** Revoking keeps the stored knowledge but stops any further fetching. */
  revokeSource(id: number): void {
    this.db.run("UPDATE sources SET approved = 0, status = 'revoked' WHERE id = ?", id);
  }

  reinstateSource(id: number): void {
    this.db.run("UPDATE sources SET approved = 1, status = 'approved' WHERE id = ?", id);
  }

  recordSourceRefresh(id: number, error: string | null): void {
    if (error) this.db.run('UPDATE sources SET last_refresh_at = ?, last_error = ? WHERE id = ?', new Date().toISOString(), error.slice(0, 500), id);
    else this.db.run("UPDATE sources SET last_refresh_at = ?, last_error = NULL, status = 'learned' WHERE id = ?", new Date().toISOString(), id);
  }

  requireSource(id: number): SourceRecord {
    const source = this.getSource(id);
    if (!source) throw new Error(`unknown source ${id}`);
    return source;
  }

  // ----------------------------------------------------------- documents

  /**
   * Store one fetched page. Identical content already stored under the same URL
   * is refreshed rather than duplicated.
   */
  storeDocument(input: {
    sourceId: number;
    url: string;
    title: string;
    text: string;
    bytes: number;
    contentType?: string;
    publishedAt?: string | null;
    updatedAt?: string | null;
  }): { readonly documentId: number; readonly chunkCount: number; readonly duplicate: boolean } {
    const hash = createHash('sha256').update(input.text).digest('hex');
    const now = new Date().toISOString();
    const existing = this.db.get<{ id: number; content_hash: string }>('SELECT id, content_hash FROM documents WHERE url = ?', input.url);

    if (existing && existing.content_hash === hash) {
      this.db.run("UPDATE documents SET fetched_at = ?, stale = 0, status = 'stored' WHERE id = ?", now, existing.id);
      return { documentId: existing.id, chunkCount: this.db.get<{ n: number }>('SELECT count(*) AS n FROM chunks WHERE document_id = ?', existing.id)?.n ?? 0, duplicate: true };
    }

    return this.db.transaction(() => {
      let documentId: number;
      if (existing) {
        documentId = existing.id;
        this.db.run("DELETE FROM chunks WHERE document_id = ?", documentId);
        this.db.run("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE document_id = ?)", documentId);
        this.db.run(
          'UPDATE documents SET title = ?, content_hash = ?, bytes = ?, fetched_at = ?, published_at = ?, updated_at = ?, stale = 0, status = ?, error = NULL WHERE id = ?',
          input.title, hash, input.bytes, now, input.publishedAt ?? null, input.updatedAt ?? null, 'stored', documentId,
        );
      } else {
        this.db.run(
          `INSERT INTO documents(source_id, url, title, content_hash, bytes, content_type, published_at, updated_at, fetched_at, status)
           VALUES (?,?,?,?,?,?,?,?,?,'stored')`,
          input.sourceId, input.url, input.title, hash, input.bytes, input.contentType ?? 'text/html',
          input.publishedAt ?? null, input.updatedAt ?? null, now,
        );
        documentId = this.lastInsertId('documents');
      }

      const chunks = chunkText(input.text);
      chunks.forEach((chunk, ordinal) => {
        this.db.run('INSERT INTO chunks(document_id, ordinal, text) VALUES (?,?,?)', documentId, ordinal, chunk);
        const chunkId = this.lastInsertId('chunks');
        this.db.run('INSERT INTO chunks_fts(rowid, text) VALUES (?,?)', chunkId, chunk);
      });
      this.db.run(
        'INSERT INTO citations(source_id, document_id, url, title, fetched_at) VALUES (?,?,?,?,?)',
        input.sourceId, documentId, input.url, input.title, now,
      );
      return { documentId, chunkCount: chunks.length, duplicate: false };
    });
  }

  listDocuments(sourceId?: number): StoredDocument[] {
    const rows = sourceId
      ? this.db.all<Record<string, unknown>>('SELECT * FROM documents WHERE source_id = ? ORDER BY fetched_at DESC', sourceId)
      : this.db.all<Record<string, unknown>>('SELECT * FROM documents ORDER BY fetched_at DESC');
    return rows.map((row) => ({
      id: row.id as number,
      url: row.url as string,
      title: row.title as string,
      contentHash: row.content_hash as string,
      bytes: row.bytes as number,
      fetchedAt: row.fetched_at as string,
      stale: Boolean(row.stale),
    }));
  }

  /** Mark stored content as out of date without deleting what we can still answer from. */
  markStale(sourceId: number): void {
    this.db.run('UPDATE documents SET stale = 1 WHERE source_id = ?', sourceId);
  }

  /** Delete everything learned from a source. */
  deleteSourceKnowledge(sourceId: number): void {
    this.db.transaction(() => {
      for (const chunk of this.db.all<{ id: number }>('SELECT id FROM chunks WHERE document_id IN (SELECT id FROM documents WHERE source_id = ?)', sourceId)) {
        this.db.run('DELETE FROM chunks_fts WHERE rowid = ?', chunk.id);
      }
      this.db.run('DELETE FROM documents WHERE source_id = ?', sourceId);
    });
  }

  // ------------------------------------------------------------ retrieval

  /**
   * Search stored knowledge. Returns passages with citable provenance.
   * Only approved sources are searched, so revoking a source stops its
   * influence on answers while leaving the data available for inspection.
   */
  search(query: string, limit = 6, onlyApproved = true): RetrievedPassage[] {
    const cleaned = query.trim();
    if (!cleaned) return [];
    // Quote each term so user punctuation cannot break FTS5 syntax.
    const match = cleaned
      .split(/\s+/)
      .map((term) => `"${term.replace(/"/g, '')}"`)
      .filter(Boolean)
      .join(' OR ');
    if (!match) return [];
    try {
      const rows = this.db.all<Record<string, unknown>>(
        `SELECT c.id AS chunk_id, c.text AS text, d.url AS url, d.title AS title, d.fetched_at AS fetched_at,
                d.stale AS stale, s.id AS source_id, s.label AS label
           FROM chunks_fts
           JOIN chunks c ON c.id = chunks_fts.rowid
           JOIN documents d ON d.id = c.document_id
           JOIN sources s ON s.id = d.source_id
          WHERE chunks_fts MATCH ?
            ${onlyApproved ? 'AND s.approved = 1' : ''}
          ORDER BY bm25(chunks_fts)
          LIMIT ?`,
        match,
        limit,
      );
      return rows.map((row) => ({
        chunkId: row.chunk_id as number,
        text: row.text as string,
        documentUrl: row.url as string,
        documentTitle: (row.title as string) || (row.url as string),
        sourceId: row.source_id as number,
        sourceLabel: (row.label as string) || (row.source_id as number).toString(),
        fetchedAt: row.fetched_at as string,
        stale: Boolean(row.stale),
      }));
    } catch {
      // A malformed FTS expression must never break a conversation.
      return [];
    }
  }

  knowledgeStats(): { sources: number; documents: number; chunks: number; bytes: number } {
    const one = <T>(sql: string): T => this.db.get<T>(sql) as T;
    return {
      sources: one<{ n: number }>("SELECT count(*) AS n FROM sources WHERE approved = 1").n,
      documents: one<{ n: number }>('SELECT count(*) AS n FROM documents').n,
      chunks: one<{ n: number }>('SELECT count(*) AS n FROM chunks').n,
      bytes: one<{ n: number }>('SELECT coalesce(sum(bytes),0) AS n FROM documents').n,
    };
  }

  /** Convert a stored record into the boundary the reader enforces. */
  boundaryFor(source: SourceRecord, pathPrefix = '/'): ApprovedSourceBoundary {
    const url = new URL(source.url);
    return { origin: url.origin, pathPrefix, maxPages: source.maxPages, maxDepth: source.maxDepth };
  }

  private lastInsertId(table: string): number {
    const row = this.db.get<{ id: number }>('SELECT last_insert_rowid() AS id');
    if (!row) throw new Error(`could not read last insert id for ${table}`);
    return row.id;
  }
}

function toSource(row: Record<string, unknown>): SourceRecord {
  return {
    id: row.id as number,
    url: row.url as string,
    host: row.host as string,
    label: row.label as string,
    approved: Boolean(row.approved),
    status: row.status as string,
    maxPages: row.max_pages as number,
    maxDepth: row.max_depth as number,
    createdAt: row.created_at as string,
    lastRefreshAt: (row.last_refresh_at as string) ?? null,
    lastError: (row.last_error as string) ?? null,
  };
}