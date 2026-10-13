import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AstraDatabase, openDatabase } = require('../dist-electron/main/knowledge/database.js');
const { MIGRATIONS, LATEST_VERSION } = require('../dist-electron/main/knowledge/schema.js');

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'astra-db-'));
}

test('a fresh database starts empty and migrates to the latest version', () => {
  const dir = tempDir();
  try {
    const db = new AstraDatabase(path.join(dir, 'astra.db'));
    assert.deepEqual(db.migrate(), MIGRATIONS.map((m) => m.version));
    assert.equal(db.currentVersion(), LATEST_VERSION);
    // Memory must start empty: no personal records exist before Karl makes any.
    assert.equal(db.get('SELECT count(*) AS n FROM memory').n, 0);
    assert.equal(db.get('SELECT count(*) AS n FROM sources').n, 0);
    assert.equal(db.get('SELECT count(*) AS n FROM coding_tasks').n, 0);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migrations are idempotent across repeated opens', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'astra.db');
    const first = new AstraDatabase(file);
    first.migrate();
    first.run('INSERT INTO sources(url, host, created_at) VALUES (?,?,?)', 'https://example.com/', 'example.com', 'now');
    first.close();

    const second = new AstraDatabase(file);
    assert.deepEqual(second.migrate(), [], 'already-applied migrations must not re-run');
    assert.equal(second.get('SELECT count(*) AS n FROM sources').n, 1, 'data must survive reopen');
    assert.equal(second.currentVersion(), LATEST_VERSION);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a rolled back migration leaves no partial schema behind', () => {
  const dir = tempDir();
  try {
    const db = new AstraDatabase(path.join(dir, 'astra.db'));
    assert.throws(() => db.transaction(() => {
      db.run('CREATE TABLE scratch(a INTEGER)');
      throw new Error('boom');
    }), /boom/);
    assert.throws(() => db.get('SELECT * FROM scratch'), /no such table/);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt database is quarantined and replaced, not destroyed', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'astra.db');
    writeFileSync(file, Buffer.from('SQLite format 3\u0000 definitely not a real database'));
    const { db, recovered, recoveredFrom } = openDatabase(file);
    assert.equal(recovered, true, 'corruption must be reported');
    assert.ok(recoveredFrom && existsSync(recoveredFrom), 'the damaged file must be kept for inspection');
    assert.equal(db.currentVersion(), LATEST_VERSION, 'the replacement must be fully migrated');
    assert.equal(db.get('SELECT count(*) AS n FROM sources').n, 0);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a healthy database opens without reporting recovery', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'astra.db');
    const first = openDatabase(file);
    first.db.close();
    const second = openDatabase(file);
    assert.equal(second.recovered, false);
    second.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backup produces a readable copy that restores the same rows', () => {
  const dir = tempDir();
  try {
    const db = new AstraDatabase(path.join(dir, 'astra.db'));
    db.migrate();
    db.run('INSERT INTO sources(url, host, created_at) VALUES (?,?,?)', 'https://a.example/', 'a.example', 'now');
    const backupPath = path.join(dir, 'backups', 'astra.db');
    db.backup(backupPath);
    assert.ok(existsSync(backupPath));
    db.close();

    const restored = new AstraDatabase(backupPath);
    restored.migrate();
    assert.equal(restored.get('SELECT count(*) AS n FROM sources').n, 1);
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('foreign keys cascade so deleting a source removes its documents and chunks', () => {
  const dir = tempDir();
  try {
    const db = new AstraDatabase(path.join(dir, 'astra.db'));
    db.migrate();
    db.run('INSERT INTO sources(url, host, created_at) VALUES (?,?,?)', 'https://b.example/', 'b.example', 'now');
    const sourceId = db.get('SELECT id FROM sources').id;
    db.run('INSERT INTO documents(source_id, url, content_hash, fetched_at) VALUES (?,?,?,?)', sourceId, 'https://b.example/a', 'h1', 'now');
    const docId = db.get('SELECT id FROM documents').id;
    db.run('INSERT INTO chunks(document_id, ordinal, text) VALUES (?,?,?)', docId, 0, 'some page text');
    db.run("INSERT INTO chunks_fts(rowid, text) VALUES (?,?)", db.get('SELECT id FROM chunks').id, 'some page text');

    db.run('DELETE FROM sources WHERE id = ?', sourceId);
    assert.equal(db.get('SELECT count(*) AS n FROM documents').n, 0);
    assert.equal(db.get('SELECT count(*) AS n FROM chunks').n, 0);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fts5 search finds stored chunk text', () => {
  const dir = tempDir();
  try {
    const db = new AstraDatabase(path.join(dir, 'astra.db'));
    db.migrate();
    db.run('INSERT INTO sources(url, host, created_at) VALUES (?,?,?)', 'https://c.example/', 'c.example', 'now');
    const sourceId = db.get('SELECT id FROM sources').id;
    db.run('INSERT INTO documents(source_id, url, content_hash, fetched_at) VALUES (?,?,?,?)', sourceId, 'https://c.example/a', 'h2', 'now');
    const docId = db.get('SELECT id FROM documents').id;
    db.run('INSERT INTO chunks(document_id, ordinal, text) VALUES (?,?,?)', docId, 0, 'sqlite full text search works');
    const chunkId = db.get('SELECT id FROM chunks').id;
    db.run('INSERT INTO chunks_fts(rowid, text) VALUES (?,?)', chunkId, 'sqlite full text search works');

    const hits = db.all('SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?', 'sqlite');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].rowid, chunkId);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('secrets are never written by the schema itself', () => {
  // The schema defines no credential columns; this guards against a later
  // migration quietly adding one. Only column definitions are checked, so
  // FTS5 options such as tokenize= do not count as a "token" column.
  const ddl = MIGRATIONS.flatMap((m) => m.statements).join('\n');
  for (const forbidden of ['password', 'token', 'api_key', 'secret', 'credential']) {
    const column = new RegExp(`\\b${forbidden}\\b\\s+(TEXT|INTEGER|REAL|BLOB)`, 'i');
    assert.ok(!column.test(ddl), `schema must not define a ${forbidden} column`);
  }
});