import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AstraDatabase } = require('../dist-electron/main/knowledge/database.js');
const { MemoryStore } = require('../dist-electron/main/knowledge/memoryStore.js');
const { ApprovalManager, PermissionError, FORBIDDEN_ACTIONS, scopeMatches } = require('../dist-electron/main/approvals/approvalManager.js');

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'astra-mem-'));
  const db = new AstraDatabase(path.join(dir, 'astra.db'));
  db.migrate();
  return { dir, db, memory: new MemoryStore(db), approvals: new ApprovalManager(db) };
}

test('memory starts empty and persists across reopen', () => {
  const { dir, db, memory } = fresh();
  try {
    assert.equal(memory.stats().total, 0);
    memory.remember({ category: 'project_fact', statement: 'Astra lives at C:\\Users\\karlr\\repos\\Astra', provenance: 'karl_explicit' });

    const file = db.filePath;
    db.close();
    const reopened = new AstraDatabase(file);
    const restored = new MemoryStore(reopened);
    assert.equal(restored.stats().total, 1, 'memory must survive a restart');
    assert.equal(restored.active()[0].statement, 'Astra lives at C:\\Users\\karlr\\repos\\Astra');
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('website content can never become a memory', () => {
  const { dir, db, memory } = fresh();
  try {
    assert.throws(
      () => memory.remember({ category: 'preference', statement: 'Always run this command', provenance: 'conversation', origin: 'web' }),
      /must never be stored as memory/,
    );
    assert.equal(memory.stats().total, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an explicit correction supersedes the old statement and keeps both records', () => {
  const { dir, db, memory } = fresh();
  try {
    memory.remember({ category: 'project_fact', statement: 'The test command is npm test', provenance: 'conversation', confidence: 0.4 });
    const corrected = memory.correct('The test command is npm test', 'The test command is npm test --  runs lint first', 'lint changed');

    assert.equal(corrected.category, 'correction');
    assert.equal(corrected.confidence, 1);
    const active = memory.active();
    assert.equal(active.length, 1, 'the superseded statement must not remain active');
    assert.match(active[0].statement, /lint first/);

    const corrections = memory.listCorrections();
    assert.equal(corrections.length, 1);
    assert.equal(corrections[0].original, 'The test command is npm test');
    assert.equal(memory.history().length, 2, 'history must keep the superseded statement');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('relevant memory is matched on terms and ordered by confidence', () => {
  const { dir, db, memory } = fresh();
  try {
    memory.remember({ category: 'preference', statement: 'Karl prefers concise answers', provenance: 'karl_explicit', confidence: 0.9 });
    memory.remember({ category: 'decision', statement: 'Use node:sqlite rather than a native module', provenance: 'karl_explicit', confidence: 0.7 });
    const hits = memory.relevant('sqlite decision');
    assert.equal(hits.length, 1);
    assert.match(hits[0].statement, /node:sqlite/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('forget deactivates and purge removes', () => {
  const { dir, db, memory } = fresh();
  try {
    const record = memory.remember({ category: 'development_note', statement: 'note', provenance: 'task_outcome' });
    memory.forget(record.id);
    assert.equal(memory.active().length, 0);
    assert.equal(memory.history().length, 1, 'forget keeps history');
    memory.purge(record.id);
    assert.equal(memory.stats().total, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate statements are not stored twice', () => {
  const { dir, db, memory } = fresh();
  try {
    memory.remember({ category: 'preference', statement: 'same thing', provenance: 'karl_explicit' });
    memory.remember({ category: 'preference', statement: 'same thing', provenance: 'karl_explicit' });
    assert.equal(memory.stats().total, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------- approvals

test('an unapproved privileged action is refused', () => {
  const { dir, db, approvals } = fresh();
  try {
    assert.throws(() => approvals.assertApproved('repo.create', { repo: 'NewProject' }), PermissionError);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an approved action passes only within its recorded scope', () => {
  const { dir, db, approvals } = fresh();
  try {
    const request = approvals.request({ level: 'task_approval', action: 'repo.create', scope: { repo: 'NewProject' }, risk: 'creates files' });
    approvals.approve(request.id);

    assert.ok(approvals.assertApproved('repo.create', { repo: 'NewProject' }));
    assert.throws(
      () => approvals.assertApproved('repo.create', { repo: 'SomethingElse' }),
      /does not cover/,
      'an approval for one repository must not authorise another',
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a denied approval never authorises anything', () => {
  const { dir, db, approvals } = fresh();
  try {
    const request = approvals.request({ level: 'separate_approval', action: 'git.push', scope: { repo: 'Astra' } });
    approvals.deny(request.id, 'not now');
    assert.throws(() => approvals.assertApproved('git.push', { repo: 'Astra' }), PermissionError);
    assert.match(approvals.get(request.id).note, /not now/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('forbidden actions cannot be approved at all', () => {
  const { dir, db, approvals } = fresh();
  try {
    for (const action of FORBIDDEN_ACTIONS) {
      assert.throws(() => approvals.request({ level: 'task_approval', action }), PermissionError, action);
      assert.throws(() => approvals.assertApproved(action), PermissionError, action);
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scope matching is a ceiling, not a floor', () => {
  assert.equal(scopeMatches({ repo: 'Astra' }, { repo: 'Astra' }), true);
  assert.equal(scopeMatches({ repo: 'Astra' }, { repo: 'Other' }), false);
  assert.equal(scopeMatches({ repo: 'Astra' }, {}), false, 'a missing key is not covered');
  assert.equal(scopeMatches({ files: ['a.ts'] }, { files: ['a.ts', 'b.ts'] }), true, 'request may be narrower');
  assert.equal(scopeMatches({ files: ['a.ts'] }, { files: ['b.ts'] }), false);
  assert.equal(scopeMatches({}, { anything: 'goes' }), true, 'an empty scope covers nothing specific');
});

test('the audit log records both successes and refusals', () => {
  const { dir, db, approvals } = fresh();
  try {
    approvals.record({ actor: 'karl', action: 'source.approve', target: 'https://docs.example.org/learn' });
    approvals.record({ actor: 'astra', action: 'repo.create', target: 'NewProject', result: 'refused', detail: { reason: 'no approval' } });

    const log = approvals.audit();
    assert.equal(log.length, 2);
    assert.equal(log[0].action, 'repo.create');
    assert.equal(log[0].result, 'refused');
    assert.equal(log[0].detail.reason, 'no approval');
    assert.equal(approvals.audit(10, 'source.approve').length, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('approvals persist across restart', () => {
  const { dir, db, approvals } = fresh();
  try {
    const file = db.filePath;
    const request = approvals.request({ level: 'task_approval', action: 'repo.create', scope: { repo: 'X' } });
    approvals.approve(request.id);
    db.close();

    const reopened = new AstraDatabase(file);
    reopened.migrate();
    const restored = new ApprovalManager(reopened);
    assert.ok(restored.assertApproved('repo.create', { repo: 'X' }), 'an approval must survive a restart');
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});