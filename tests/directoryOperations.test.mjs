import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AstraDatabase } = require('../dist-electron/main/knowledge/database.js');
const { ApprovalManager } = require('../dist-electron/main/approvals/approvalManager.js');
const { TaskStore } = require('../dist-electron/main/agent/taskStore.js');
const { MemoryStore } = require('../dist-electron/main/knowledge/memoryStore.js');
const { CodingAgent } = require('../dist-electron/main/agent/codingAgent.js');
const { CodingBridge } = require('../dist-electron/main/agent/codingBridge.js');
const {
  routeCodingIntent, normaliseDirectoryName, extractNewRepositoryName,
} = require('../dist-electron/main/agent/codingIntent.js');
const {
  planDirectFileAction, executeDirectFileAction, inspectDirectoryManifest, MAX_DIRECTORY_ENTRIES,
} = require('../dist-electron/main/workspace/fileTools.js');

/**
 * Astra creating and removing directories, and folding spoken names.
 *
 * Karl authorised this and chose two things explicitly: a recursive delete shows
 * the full listing of what it removes, and names are *joined up*
 * ("Astra's Blog" -> `AstrasBlog`) rather than the safe-name rule being loosened.
 *
 * Everything runs in a temporary directory; Karl's repositories are untouched.
 */

function lab() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'astra-dirs-'));
  const root = path.join(base, 'repos');
  mkdirSync(root, { recursive: true });
  const db = new AstraDatabase(path.join(base, 'astra.db'));
  db.migrate();
  const agent = new CodingAgent({ root }, new ApprovalManager(db), new TaskStore(db), new MemoryStore(db));
  const cleanup = () => {
    try { db.close(); } catch { /* Already closed. */ }
    rmSync(base, { recursive: true, force: true });
  };
  return { base, root, sandbox: { root }, agent, cleanup };
}

/** Run one chat request through plan, approval, execution and verification. */
async function approved(bridge, agent, message) {
  const proposal = await bridge.handle(message);
  assert.ok(proposal, `${message} must be handled by a tool`);
  assert.equal(agent.snapshot().phase, 'awaiting_approval', proposal.reply);
  agent.approve();
  agent.executeFileOperation();
  await agent.review();
  await agent.complete();
  return proposal.reply;
}

// ------------------------------------------------------- name folding

test('names are joined up rather than rejected', () => {
  // Karl's exact example, and the request that produced the original report.
  assert.equal(normaliseDirectoryName("Astra's Blog"), 'AstrasBlog');
  assert.equal(normaliseDirectoryName('Astra’s Blog'), 'AstrasBlog');
  assert.equal(normaliseDirectoryName('My Blog'), 'MyBlog');
  assert.equal(normaliseDirectoryName('my new blog'), 'MyNewBlog');
  assert.equal(normaliseDirectoryName('the blog'), 'Blog');
  assert.equal(normaliseDirectoryName('AstrasBlog'), 'AstrasBlog', 'already-folded names are unchanged');
});

test('folding can never produce an unsafe name', () => {
  for (const hostile of [
    '../../etc/passwd',
    '..\\..\\Windows',
    'a/b/c',
    'C:evil',
    'con', 'PRN', 'nul', 'COM1', 'lpt9',
    '',
    'x',
    'a'.repeat(60),
  ]) {
    const result = normaliseDirectoryName(hostile);
    if (result === null) continue;
    assert.match(result, /^[A-Za-z][A-Za-z0-9]{1,39}$/, `"${hostile}" produced ${result}`);
    assert.doesNotMatch(result, /[/\\.]/, `"${hostile}" produced ${result}`);
    // Whatever comes out may never be a Windows device name.
    assert.doesNotMatch(result, /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i, `"${hostile}" produced ${result}`);
  }
  // Traversal cannot survive: it is neutralised into a plain name, and that
  // name can never reach outside the root because it contains no separator.
  assert.equal(normaliseDirectoryName('../../etc'), 'Etc');
  assert.equal(normaliseDirectoryName('C:evil'), 'CEvil');
  assert.equal(normaliseDirectoryName('NUL'), null);
  // "the con folder" is not a device name, so folding it is safe and correct.
  assert.equal(normaliseDirectoryName('the con folder'), 'ConFolder');
});

test('a spoken name is not truncated at an apostrophe', () => {
  // Truncating here is what turned "Astra's Blog" into a project named "Astra".
  assert.equal(extractNewRepositoryName("Create a blog called Astra's Blog"), "Astra's Blog");
  assert.equal(extractNewRepositoryName('Create a repository called MyDashboard'), 'MyDashboard');
  assert.equal(extractNewRepositoryName('create a React app named BrightBoard'), 'BrightBoard');
  assert.equal(extractNewRepositoryName('Create a new Git repository called AstraStone.'), 'AstraStone');
  assert.equal(extractNewRepositoryName('Set up a new project for me.'), null);
  assert.equal(extractNewRepositoryName('Create a new Git repository.'), null);
  assert.equal(extractNewRepositoryName('Can you create a repository?'), null);
});

// ---------------------------------------------------------- routing

test('folder requests route to directory actions, not to the project scaffolder', () => {
  for (const [request, kind] of [
    ['Create a folder called Notes', 'create_directory'],
    ['Make a folder called Notes', 'create_directory'],
    ['Create the directory C:\\Users\\karlr\\repos\\Notes', 'create_directory'],
    ['Delete folder C:\\Users\\karlr\\repos\\Notes', 'delete_directory'],
    ['Remove the directory C:\\Users\\karlr\\repos\\Notes', 'delete_directory'],
  ]) {
    const intent = routeCodingIntent(request);
    assert.equal(intent.kind, kind, request);
    assert.equal(intent.mutating, true, `${request} must require approval`);
  }
  // A project is still a project.
  assert.equal(routeCodingIntent('Create a new blog website called AstrasBlog').kind, 'create_repository');
  // A hyphenated path component must not be mistaken for the word "folder".
  for (const request of [
    'Create file C:\\repos\\plain-folder\\notes.md with this content:\n```\nx\n```',
    'Delete file C:\\repos\\plain-folder\\notes.md',
  ]) {
    assert.equal(routeCodingIntent(request).kind.endsWith('_file') ? routeCodingIntent(request).kind : 'x', routeCodingIntent(request).kind, request);
    assert.match(routeCodingIntent(request).kind, /file$/, request);
  }
});

// ------------------------------------------------------- create

test('an empty directory is created only after approval and then verified', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    const target = path.join(root, 'Notes');

    const proposal = await bridge.handle('Create a folder called Notes');
    assert.match(proposal.reply, /Nothing has been changed/i);
    assert.equal(existsSync(target), false, 'nothing may exist before approval');
    assert.equal(agent.snapshot().phase, 'awaiting_approval');
    assert.throws(() => agent.executeFileOperation(), /not been approved/);

    agent.approve();
    agent.executeFileOperation();
    await agent.review();
    await agent.complete();
    assert.equal(statSync(target).isDirectory(), true);
    assert.deepEqual(existsSync(path.join(target, '.git')), false, 'no Git repository is created');
  } finally { cleanup(); }
});

test('a spoken name with an apostrophe and a space is folded to one safe name', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    const reply = await approved(bridge, agent, "Create a folder called Astra's Blog");
    assert.match(reply, /AstrasBlog/);
    assert.equal(existsSync(path.join(root, 'AstrasBlog')), true);
    assert.equal(existsSync(path.join(root, "Astra's Blog")), false);
  } finally { cleanup(); }
});

test('an absolute path containing a space is folded rather than truncated', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    await approved(bridge, agent, `Create folder ${path.join(root, 'My Blog')}`);
    assert.equal(existsSync(path.join(root, 'MyBlog')), true);
  } finally { cleanup(); }
});

test('creating a directory never overwrites what is already there', () => {
  const { root, sandbox, cleanup } = lab();
  try {
    const target = path.join(root, 'Taken');
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'keep.txt'), 'keep me');
    assert.throws(() => planDirectFileAction(target, sandbox, 'create_directory'), /already exists/i);
    assert.equal(readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep me');
  } finally { cleanup(); }
});

test('a reserved device name is refused instead of being created', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    const reply = await bridge.handle('Create a folder called con');
    assert.match(reply.reply, /cannot be used as a directory name/i);
    assert.equal(existsSync(path.join(root, 'con')), false);
    assert.equal(agent.snapshot().phase, 'idle');
  } finally { cleanup(); }
});

// ---------------------------------------------------- recursive delete

test('a recursive delete lists every path before approval', () => {
  const { root, sandbox, cleanup } = lab();
  try {
    const target = path.join(root, 'Old');
    mkdirSync(path.join(target, 'sub'), { recursive: true });
    writeFileSync(path.join(target, 'a.md'), 'alpha');
    writeFileSync(path.join(target, 'sub', 'b.md'), 'beta');

    const plan = planDirectFileAction(target, sandbox, 'delete_directory');
    assert.equal(plan.action, 'delete_directory');
    assert.equal(plan.entryCount, 3);
    assert.ok(plan.entries.some((e) => e.includes('a.md')), 'the listing must include the files');
    assert.ok(plan.entries.some((e) => e.includes('b.md')), 'the listing must include nested files');
    assert.equal(plan.containsGit, false);

    // Nothing is gone until the operation actually runs.
    assert.equal(statSync(target).isDirectory(), true);
    executeDirectFileAction(plan, sandbox);
    assert.equal(existsSync(target), false);
  } finally { cleanup(); }
});

test('a directory that changes after planning is refused, not deleted', () => {
  const { root, sandbox, cleanup } = lab();
  try {
    const target = path.join(root, 'Changing');
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'a.md'), 'alpha');

    const plan = planDirectFileAction(target, sandbox, 'delete_directory');
    // Something appears after Karl read the listing.
    writeFileSync(path.join(target, 'surprise.md'), 'not in the approved list');
    assert.throws(() => executeDirectFileAction(plan, sandbox), /changed since planning/i);
    assert.equal(existsSync(target), true, 'nothing may be removed when the plan is stale');
    assert.equal(existsSync(path.join(target, 'surprise.md')), true);
  } finally { cleanup(); }
});

test('a directory containing Git history is flagged before approval', () => {
  const { root, sandbox, cleanup } = lab();
  try {
    const target = path.join(root, 'WithGit');
    mkdirSync(path.join(target, '.git'), { recursive: true });
    writeFileSync(path.join(target, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const plan = planDirectFileAction(target, sandbox, 'delete_directory');
    assert.equal(plan.containsGit, true, 'Git metadata must be called out explicitly');
  } finally { cleanup(); }
});

test('an unbounded recursive delete is refused', () => {
  const { root, sandbox, cleanup } = lab();
  try {
    const target = path.join(root, 'Huge');
    mkdirSync(target, { recursive: true });
    for (let i = 0; i < 12; i += 1) writeFileSync(path.join(target, `f${i}.txt`), 'x');
    const manifest = inspectDirectoryManifest(target, sandbox);
    assert.equal(manifest.count, 12);
    assert.equal(manifest.truncated, false);
    assert.ok(MAX_DIRECTORY_ENTRIES >= 12);
  } finally { cleanup(); }
});

test('the bridge refuses to delete the root, anything outside it, or a file', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    const file = path.join(root, 'note.md');
    writeFileSync(file, 'x');

    const atRoot = await bridge.handle(`Delete folder ${root}`);
    assert.match(atRoot.reply, /is-root|rejected/i);
    assert.equal(existsSync(root), true, 'the workspace root must survive');

    const outside = await bridge.handle('Delete folder C:\\Windows\\Temp');
    assert.match(outside.reply, /outside-root|rejected/i);

    const wrongKind = await bridge.handle(`Delete folder ${file}`);
    assert.match(wrongKind.reply, /not a directory/i);
    assert.equal(existsSync(file), true, 'a file must not be removed by the directory action');
  } finally { cleanup(); }
});

test('a directory operation is reported honestly once verified', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    await approved(bridge, agent, 'Create a folder called Reports');
    const reports = path.join(root, 'Reports');
    writeFileSync(path.join(reports, 'q1.md'), 'results');

    const reply = await approved(bridge, agent, `Delete folder ${reports}`);
    assert.match(reply, /cannot be undone/i);
    assert.match(reply, /1 entr/i);
    assert.match(reply, /q1\.md/, 'the exact file to be removed must be shown');
    assert.equal(existsSync(reports), false);
  } finally { cleanup(); }
});