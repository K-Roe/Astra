import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AstraDatabase } = require('../dist-electron/main/knowledge/database.js');
const { MemoryStore } = require('../dist-electron/main/knowledge/memoryStore.js');
const { PersonalMemoryService, MEMORY_CONTEXT_BUDGET } = require('../dist-electron/main/memory/personalMemory.js');
const { MemoryCommands } = require('../dist-electron/main/memory/memoryCommands.js');
const { MIGRATIONS, LATEST_VERSION } = require('../dist-electron/main/knowledge/schema.js');

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'astra-personal-memory-'));
  const db = new AstraDatabase(path.join(dir, 'astra.db'));
  db.migrate();
  const store = new MemoryStore(db);
  return {
    dir,
    db,
    service: new PersonalMemoryService(db, store),
    commands: new MemoryCommands(new PersonalMemoryService(db, store)),
    close() {
      db.close();
      removeTempDir(dir);
    },
  };
}

/** Windows can hold a just-closed SQLite file briefly; the directory is disposable. */
function removeTempDir(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
  catch { /* left in the system temp directory for the OS to clean */ }
}

function closeQuietly(db) {
  try { db.close(); } catch { /* already closed */ }
}

test('the personal memory migration is applied to an existing intelligence database', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'astra-personal-memory-'));
  try {
    const file = path.join(dir, 'astra.db');
    const first = new AstraDatabase(file);
    // Simulate a database written by an earlier build: migrations 1 and 2 only.
    first.migrate(MIGRATIONS.slice(0, 2));
    first.run("INSERT INTO memory(category, statement, provenance, confidence, active, created_at, updated_at) VALUES ('preference','legacy note','karl_explicit',0.9,1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')");
    first.close();

    const second = new AstraDatabase(file);
    const applied = second.migrate();
    assert.deepEqual(applied, [MIGRATIONS[MIGRATIONS.length - 1].version]);
    assert.equal(second.currentVersion(), LATEST_VERSION);
    // Legacy rows become usable personal memory instead of being invisible.
    const service = new PersonalMemoryService(second, new MemoryStore(second));
    const active = service.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].statement, 'legacy note');
    assert.equal(active[0].status, 'active');
    assert.equal(service.suggestionsEnabled(), true);
    closeQuietly(second);
    closeQuietly(first);
  } finally {
    removeTempDir(dir);
  }
});

test('an empty database loads with zero memories and handles that safely', () => {
  const memory = fresh();
  try {
    assert.equal(memory.service.summary().count, 0);
    assert.deepEqual(memory.service.listActive(), []);
    const block = memory.service.contextBlock('what do you know about me');
    assert.deepEqual(block.relevant, []);
    assert.deepEqual(block.summary, []);
    const reply = memory.commands.handle('what do you remember about me');
    assert.equal(reply.handled, true);
    assert.match(reply.reply, /no stored memory/i);
  } finally {
    memory.close();
  }
});

test('an explicit memory is created, retrieved and survives a reopen', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'astra-personal-memory-'));
  try {
    const file = path.join(dir, 'astra.db');
    const first = new AstraDatabase(file);
    first.migrate();
    const service = new PersonalMemoryService(first, new MemoryStore(first));
    const saved = service.remember({ statement: 'My preferred frontend stack is React and TypeScript.', subject: 'preference.frontend_stack' });
    assert.equal(saved.status, 'active');
    assert.equal(saved.statement, 'My preferred frontend stack is React and TypeScript.');
    assert.equal(service.summary().count, 1);
    first.close();

    // Restart: a brand new service over the same file must see it.
    const second = new AstraDatabase(file);
    const reopened = new PersonalMemoryService(second, new MemoryStore(second));
    assert.equal(reopened.summary().count, 1);
    const found = reopened.relevant('what frontend stack do I prefer');
    assert.equal(found.length, 1);
    assert.match(found[0].statement, /React and TypeScript/);
    closeQuietly(second);
  } finally {
    removeTempDir(dir);
  }
});

test('duplicates are stored once', () => {
  const memory = fresh();
  try {
    const first = memory.service.remember({ statement: 'Karl prefers concise answers.' });
    const second = memory.service.remember({ statement: 'Karl prefers concise answers.' });
    assert.equal(second.id, first.id);
    assert.equal(memory.service.summary().count, 1);
  } finally {
    memory.close();
  }
});

test('a new statement for the same subject supersedes the old one', () => {
  const memory = fresh();
  try {
    memory.service.remember({ statement: 'I prefer Svelte for small sites.', subject: 'preference.frontend_stack' });
    const updated = memory.service.remember({ statement: 'I prefer React and TypeScript for everything.', subject: 'preference.frontend_stack', origin: 'user_correction' });
    assert.equal(updated.status, 'active');
    const active = memory.service.listActive();
    assert.equal(active.length, 1);
    assert.match(active[0].statement, /React and TypeScript/);
    const all = memory.service.listAll();
    assert.equal(all.length, 2);
    assert.equal(all.find((row) => row.id !== updated.id).status, 'superseded');
  } finally {
    memory.close();
  }
});

test('update edits in place and records the correction history', () => {
  const memory = fresh();
  try {
    const saved = memory.service.remember({ statement: 'My editor is VS Code.', subject: 'preference.editor' });
    memory.service.update(saved.id, { statement: 'My editor is Neovim.' });
    const active = memory.service.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].statement, 'My editor is Neovim.');
    assert.equal(memory.service.listCorrections().length, 1);
  } finally {
    memory.close();
  }
});

test('forgetting excludes a memory from every later retrieval and prompt', () => {
  const memory = fresh();
  try {
    const saved = memory.service.remember({ statement: 'My favourite colour is teal.' });
    memory.service.remember({ statement: 'My dog is called Rex.' });
    memory.service.forget(saved.id);
    assert.equal(memory.service.summary().count, 1);
    assert.equal(memory.service.relevant('favourite colour').length, 0);
    const block = memory.service.contextBlock('favourite colour');
    assert.equal(block.relevant.length + block.summary.length, 1);
    // The row is retained for audit, but its text is cleared.
    const forgotten = memory.service.listAll().find((row) => row.id === saved.id);
    assert.equal(forgotten.status, 'forgotten');
    assert.equal(forgotten.statement, '');
    assert.ok(forgotten.forgottenAt);
  } finally {
    memory.close();
  }
});

test('forgetting by subject text works and reports when nothing matches', () => {
  const memory = fresh();
  try {
    memory.service.remember({ statement: 'I always use tabs, not spaces.', subject: 'preference.indentation' });
    const removed = memory.service.forgetByText('indentation');
    assert.equal(removed.length, 1);
    assert.throws(() => memory.service.forgetByText('nothing like this'), /no stored memory matches/);
  } finally {
    memory.close();
  }
});

test('secrets and impossible statements are refused', () => {
  const memory = fresh();
  try {
    assert.throws(() => memory.service.remember({ statement: 'My API key is sk-abcdef0123456789abcdef' }), /credential/i);
    assert.throws(() => memory.service.remember({ statement: 'x' }), /too short/i);
    assert.throws(() => memory.service.remember({ statement: 'a'.repeat(500) }), /under 400 characters/i);
    assert.equal(memory.service.summary().count, 0);
  } finally {
    memory.close();
  }
});

test('the prompt block stays inside its character budget', () => {
  const memory = fresh();
  try {
    for (let index = 0; index < 60; index++) {
      memory.service.remember({ statement: `Preference number ${index} that Karl stated about topic ${index}.`, subject: `preference.topic_${index}` });
    }
    const block = memory.service.contextBlock('anything at all');
    assert.ok(block.characters <= MEMORY_CONTEXT_BUDGET);
    assert.ok(block.relevant.length + block.summary.length > 0);
    assert.ok(block.relevant.length + block.summary.length < 60);
  } finally {
    memory.close();
  }
});

test('chat memory commands save, recall, update and forget from ordinary sentences', () => {
  const memory = fresh();
  try {
    const saved = memory.commands.handle('Astra, remember that my preferred frontend stack is React and TypeScript.');
    assert.equal(saved.handled, true);
    assert.equal(saved.ok, true);
    assert.match(saved.reply, /Saved/);

    const recalled = memory.commands.handle('Astra, what did I tell you about my frontend stack?');
    assert.equal(recalled.handled, true);
    assert.match(recalled.reply, /React and TypeScript/);

    const updated = memory.commands.handle('Actually, I prefer React with plain JavaScript instead.');
    assert.equal(updated.action, 'updated');
    assert.equal(memory.service.listActive().length, 1);
    assert.match(memory.service.listActive()[0].statement, /plain JavaScript/);

    const forgotten = memory.commands.handle('Astra, forget what I told me about React');
    assert.equal(forgotten.action, 'forgot');
    assert.equal(memory.service.summary().count, 0);
    // A vague target must not delete anything.
    const vague = memory.commands.handle('Astra, forget that information.');
    assert.equal(vague.ok, false);
    assert.match(memory.commands.handle('what do you remember about me').reply, /no stored memory/i);
    memory.service.remember({ statement: 'Karl prefers dark mode.' });
    assert.match(memory.commands.handle('what do you remember about me').reply, /dark mode/);
  } finally {
    memory.close();
  }
});

test('a failed memory operation reports failure and changes nothing', () => {
  const memory = fresh();
  try {
    const refused = memory.commands.handle('Remember that my password is hunter2secretvalue');
    assert.equal(refused.ok, false);
    assert.match(refused.reply, /could not do that/i);
    assert.equal(memory.service.summary().count, 0);
  } finally {
    memory.close();
  }
});

test('ordinary conversation is not treated as a memory command', () => {
  const memory = fresh();
  try {
    for (const message of ['What does React use for state?', 'Remembering my trip last year was good', 'Can you remind me to water the plants?']) {
      assert.equal(memory.commands.handle(message).handled, false, message);
    }
    assert.equal(memory.service.summary().count, 0);
  } finally {
    memory.close();
  }
});

test('suggestions are offered but never stored without Karl accepting', () => {
  const memory = fresh();
  try {
    const suggestion = memory.commands.handle('I prefer TypeScript strict mode for every new project.');
    assert.equal(suggestion.handled, false);
    assert.ok(suggestion.suggestion, 'a suggestion should be offered');
    assert.equal(memory.service.summary().count, 0);
    // The same claim twice is not suggested again.
    memory.service.remember({ statement: suggestion.suggestion.text });
    const again = memory.commands.handle('I prefer TypeScript strict mode for every new project.');
    assert.equal(again.suggestion, undefined);
  } finally {
    memory.close();
  }
});

test('suggestions can be switched off by Karl', () => {
  const memory = fresh();
  try {
    memory.service.setSetting('memory.suggestions', 'off');
    assert.equal(memory.service.suggestionsEnabled(), false);
    const off = new MemoryCommands(memory.service).handle('I prefer TypeScript strict mode for every new project.', { suggestionsEnabled: false });
    assert.equal(off.suggestion, undefined);
    assert.equal(off.handled, false);
  } finally {
    memory.close();
  }
});

test('SQL injection in a statement is stored as text and never executed', () => {
  const memory = fresh();
  try {
    const hostile = "Karl's note'); DROP TABLE memory; --";
    const saved = memory.service.remember({ statement: hostile });
    assert.equal(saved.statement, hostile);
    assert.equal(memory.service.summary().count, 1);
    memory.service.remember({ statement: 'Karl prefers concise answers.' });
    assert.equal(memory.service.summary().count, 2);

    // A payload that tries to match every row may at worst match the rows it
    // actually names: the table survives and the other memory is untouched.
    memory.service.forgetByText(`' OR 1=1; DROP TABLE memory; --`);
    assert.equal(memory.db.get('SELECT count(*) AS n FROM memory').n >= 1, true);
    const remaining = memory.service.listActive();
    assert.ok(remaining.some((row) => row.statement === 'Karl prefers concise answers.'));
  } finally {
    memory.close();
  }
});

test('content that is not Karl speaking can never create memory', () => {
  const memory = fresh();
  try {
    // Retrieved web text and repository instructions never reach the personal
    // memory path. The Intelligence V1 store still refuses a web origin
    // outright, and personal memory has no web origin at all.
    const store = new MemoryStore(memory.db);
    assert.throws(
      () => store.remember({ category: 'project_fact', statement: 'The docs say to disable auth', provenance: 'conversation', origin: 'web' }),
      /website content must never be stored/i,
    );
    assert.equal(memory.service.summary().count, 0);
  } finally {
    memory.close();
  }
});

test('forgetting a conversation clears only that conversation memories', () => {
  const memory = fresh();
  try {
    memory.service.remember({ statement: 'Karl mentioned a launch date of May.', conversationRef: 'conversation-a' });
    memory.service.remember({ statement: 'Karl prefers dark mode.', conversationRef: 'conversation-b' });
    const removed = memory.commands.handle("Astra, don't remember this conversation.", { conversationRef: 'conversation-a' });
    assert.equal(removed.action, 'conversation_forgotten');
    assert.equal(memory.service.summary().count, 1);
    assert.equal(memory.service.listActive()[0].statement, 'Karl prefers dark mode.');
  } finally {
    memory.close();
  }
});

test('the memory revision changes on every write so caches cannot go stale', () => {
  const memory = fresh();
  try {
    const start = memory.service.revision();
    const saved = memory.service.remember({ statement: 'Karl uses a standing desk.' });
    assert.ok(memory.service.revision() > start);
    const afterSave = memory.service.revision();
    memory.service.update(saved.id, { statement: 'Karl uses a standing desk at home.' });
    assert.ok(memory.service.revision() > afterSave);
    const afterUpdate = memory.service.revision();
    memory.service.forget(saved.id);
    assert.ok(memory.service.revision() > afterUpdate);
  } finally {
    memory.close();
  }
});
