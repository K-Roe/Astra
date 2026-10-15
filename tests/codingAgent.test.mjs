import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AstraDatabase } = require('../dist-electron/main/knowledge/database.js');
const { ApprovalManager, PermissionError } = require('../dist-electron/main/approvals/approvalManager.js');
const { TaskStore } = require('../dist-electron/main/agent/taskStore.js');
const { MemoryStore } = require('../dist-electron/main/knowledge/memoryStore.js');
const { CodingAgent, scopeFingerprint, classifyCheck } = require('../dist-electron/main/agent/codingAgent.js');
const { CodingBridge, buildScaffold, extractSearchHints } = require('../dist-electron/main/agent/codingBridge.js');

/**
 * Every test runs against a disposable repository in a temporary directory.
 * Karl's real projects are never touched.
 */
function lab(name = 'DemoApp') {
  const base = mkdtempSync(path.join(tmpdir(), 'astra-ca01-'));
  const root = path.join(base, 'repos');
  const repo = path.join(root, name);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'demo-app', scripts: { test: 'node test.js' } }, null, 2));
  writeFileSync(path.join(repo, 'src', 'sum.js'), 'export function sum(a, b) {\n  return a - b;\n}\n');
  writeFileSync(path.join(repo, 'test.js'), "import { sum } from './src/sum.js';\nif (sum(2, 3) !== 5) { console.error('expected 5'); process.exit(1); }\nconsole.log('tests passed');\n");
  writeFileSync(path.join(repo, '.env'), 'TOKEN=secret\n');
  writeFileSync(path.join(repo, 'README.md'), '# DemoApp\n\nA disposable test repository.\n');

  const db = new AstraDatabase(path.join(base, 'astra.db'));
  db.migrate();
  const approvals = new ApprovalManager(db);
  const agent = new CodingAgent({ root }, approvals, new TaskStore(db), new MemoryStore(db));
  // Windows locks a directory while a handle is open, so cleanup closes the
  // database first; a test that already closed it is harmless.
  const cleanup = () => {
    try {
      db.close();
    } catch {
      // Already closed by the test.
    }
    rmSync(base, { recursive: true, force: true });
  };
  return { base, root, repo, agent, db, approvals, sandbox: { root }, cleanup };
}

/** A lab with the repository already selected, as the chat bridge does. */
function selectedLab(name) {
  const ctx = lab(name);
  if (name !== undefined) ctx.agent.selectRepository(name);
  else ctx.agent.selectRepository(ctx.repo);
  return ctx;
}

const PATCH = [{ file: 'src/sum.js', hunks: [{ find: 'return a - b;', replace: 'return a + b;' }] }];
const proposeFixture = async () => ({ rootCause: 'sum subtracts instead of adding', expectedOutcome: 'sum(2, 3) returns 5', risks: [], patches: PATCH });
const plan = (over = {}) => ({
  objective: 'Fix sum() so it adds',
  searchHints: ['return a - b'],
  proposedFiles: ['src/sum.js'],
  proposedPatches: PATCH,
  proposedCommands: [{ executable: 'node', args: ['test.js'], purpose: 'run the tests' }],
  rootCause: 'The operator is subtraction instead of addition.',
  ...over,
});

test('an exit-zero test run with every test skipped is not called a pass', () => {
  assert.equal(classifyCheck({ ok: true, stdout: '# tests 1\n# pass 0\n# skipped 1', stderr: '' }), 'skipped');
  assert.equal(classifyCheck({ ok: true, stdout: '# tests 2\n# pass 1\n# skipped 1', stderr: '' }), 'passed');
  assert.equal(classifyCheck({ ok: false, stdout: '', stderr: '' }), 'failed');
});

// ------------------------------------------------------------------ tests

test('investigation produces a plan and changes nothing', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    const before = readFileSync(path.join(repo, 'src', 'sum.js'), 'utf8');
    const snapshot = await agent.beginTask(plan());
    assert.equal(snapshot.phase, 'awaiting_approval');
    assert.ok(snapshot.plan);
    assert.deepEqual(snapshot.plan.filesToChange, ['src/sum.js']);
    assert.equal(snapshot.changes.length, 0, 'no change may be recorded before approval');
    assert.equal(readFileSync(path.join(repo, 'src', 'sum.js'), 'utf8'), before, 'the file must be untouched');
  } finally {
    cleanup();
  }
});

test('changes are refused until the plan is approved', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    await assert.rejects(() => agent.implement({ patches: PATCH }), PermissionError);
    assert.match(readFileSync(path.join(repo, 'src', 'sum.js'), 'utf8'), /return a - b/, 'file must be unchanged');
  } finally {
    cleanup();
  }
});

test('a pending approval cannot be redirected to another discovered repository', async () => {
  const { agent, root, repo, cleanup } = selectedLab();
  const other = path.join(root, 'OtherApp');
  try {
    mkdirSync(path.join(other, 'src'), { recursive: true });
    writeFileSync(path.join(other, 'src', 'sum.js'), 'export function sum(a, b) { return a - b; }\n');
    writeFileSync(path.join(other, 'package.json'), '{"name":"other-app"}\n');
    await agent.beginTask(plan({ proposedPatches: PATCH }));
    assert.throws(() => agent.selectRepository(other), /cancel or finish the current task/i);
    assert.equal(agent.snapshot().repository, repo);
    agent.approve();
    // The execution guard also protects the boundary if internal state drifts.
    agent.repository = other;
    await assert.rejects(() => agent.implement({ patches: PATCH }), /selected repository differs/i);
    assert.match(readFileSync(path.join(other, 'src', 'sum.js'), 'utf8'), /return a - b/);
  } finally {
    cleanup();
  }
});

test('chat cannot start a second test or review while approved work is executing', async () => {
  const { agent, sandbox, cleanup } = selectedLab();
  try {
    const bridge = new CodingBridge(agent, sandbox, proposeFixture, () => true);
    const testReply = await bridge.handle('Run the approved tests');
    const diffReply = await bridge.handle('Show me what you changed');
    assert.match(testReply.reply, /already running/i);
    assert.match(diffReply.reply, /still running/i);
    assert.equal(agent.snapshot().testResults.length, 0);
  } finally {
    cleanup();
  }
});

test('a failed coding-model route stops before a proposal or plan', async () => {
  const { agent, sandbox, cleanup } = selectedLab();
  try {
    const proposer = async () => { throw new Error('proposer should not run'); };
    const bridge = new CodingBridge(agent, sandbox, proposer, () => false, () => ({ permitted: false, reason: 'benchmark below threshold' }));
    const result = await bridge.handle('Fix the bug');
    assert.match(result.reply, /benchmark below threshold/i);
    assert.equal(agent.snapshot().taskId, null);
  } finally {
    cleanup();
  }
});

test('a named repository cannot silently override a different selection', async () => {
  const { agent, root, sandbox, cleanup } = selectedLab();
  const other = path.join(root, 'OtherApp');
  try {
    mkdirSync(other, { recursive: true });
    writeFileSync(path.join(other, 'package.json'), '{"name":"other-app"}\n');
    const bridge = new CodingBridge(agent, sandbox, proposeFixture);
    const result = await bridge.handle('Fix the login bug in OtherApp');
    assert.match(result.reply, /selected repository is .*DemoApp.*request names .*OtherApp/i);
    assert.equal(agent.snapshot().taskId, null);
    assert.equal(agent.getRepository(), path.join(root, 'DemoApp'));
  } finally {
    cleanup();
  }
});

test('a rejected plan changes nothing and runs nothing', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    agent.reject('Karl declined');
    await assert.rejects(() => agent.implement({ patches: PATCH }), PermissionError);
    await assert.rejects(() => agent.runApprovedCommand('node', ['test.js']), PermissionError);
    assert.match(readFileSync(path.join(repo, 'src', 'sum.js'), 'utf8'), /return a - b/);
    const refusals = agent.snapshot().events.filter((e) => e.kind === 'approval.rejected');
    assert.equal(refusals.length, 1);
  } finally {
    cleanup();
  }
});

test('an approved plan applies a real patch and the real test passes', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    agent.approve();
    await agent.implement({ patches: PATCH });
    assert.match(readFileSync(path.join(repo, 'src', 'sum.js'), 'utf8'), /return a \+ b/);

    const after = await agent.runApprovedCommand('node', ['test.js']);
    const result = after.testResults.at(-1);
    assert.equal(result.ok, true, `test should pass, got: ${result.summary}`);
    assert.equal(result.exitCode, 0);
  } finally {
    cleanup();
  }
});

test('a failing test is reported honestly, not as a success', async () => {
  const { agent, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    agent.approve();
    const before = await agent.runApprovedCommand('node', ['test.js']);
    const failing = before.testResults.at(-1);
    assert.equal(failing.ok, false);
    assert.equal(failing.exitCode, 1);
    assert.match(failing.summary, /failed with exit 1/);
  } finally {
    cleanup();
  }
});

test('a command outside the approved set is refused and audited', async () => {
  const { agent, approvals, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    agent.approve();
    await assert.rejects(
      () => agent.runApprovedCommand('node', ['-e', 'process.exit(0)']),
      /not in the approved command set|CommandRejected/,
    );
    const audit = approvals.audit(20, 'command.refused');
    assert.ok(audit.length >= 1, 'a refusal must be audited');
  } finally {
    cleanup();
  }
});

test('dependency installation is refused even when approved in the plan', async () => {
  const { agent, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan({ proposedCommands: [{ executable: 'npm', args: ['install'], purpose: 'install' }] }));
    agent.approve();
    await assert.rejects(() => agent.runApprovedCommand('npm', ['install']), /CommandRejected|Dependency|install/i);
  } finally {
    cleanup();
  }
});

test('editing a file outside the approved list is refused', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    agent.approve();
    await assert.rejects(
      () => agent.implement({ patches: [{ file: 'src/other.js', hunks: [{ find: 'a', replace: 'b' }] }] }),
      /patch differs from the approved plan/,
    );
    assert.equal(existsSync(path.join(repo, 'src', 'other.js')), false);
  } finally {
    cleanup();
  }
});

test('changing the scope after approval invalidates the approval', async () => {
  const { agent, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    agent.approve();
    // Simulate a plan edited after Karl approved it.
    const current = agent.snapshot().plan;
    assert.ok(current);
    assert.notEqual(scopeFingerprint({ ...current, filesToChange: [...current.filesToChange, 'src/extra.js'] }), scopeFingerprint(current));
  } finally {
    cleanup();
  }
});

test('unrelated existing work is preserved during investigation', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    writeFileSync(path.join(repo, 'src', 'unrelated.js'), "export const karlsWork = 'do not touch';\n");
    const snapshot = await agent.beginTask(plan());
    assert.equal(snapshot.phase, 'awaiting_approval');
    // Karl's file is still there after investigation.
    assert.ok(existsSync(path.join(repo, 'src', 'unrelated.js')));
  } finally {
    cleanup();
  }
});

test('a dirty file with spaces cannot be overwritten through an approved write', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    const target = path.join(repo, 'src', 'Karl notes.js');
    writeFileSync(target, 'keep this\n');
    await agent.beginTask(plan({ proposedFiles: ['src/Karl notes.js'] }));
    agent.approve();
    await assert.rejects(() => agent.implement({ patches: [], writes: [{ file: 'src/Karl notes.js', content: 'overwrite\n' }] }), /approved workspace scope/i);
    assert.equal(readFileSync(target, 'utf8'), 'keep this\n');
  } finally { cleanup(); }
});

test('a renderer cannot supply unreviewed file content to an approved coding task', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan({ proposedFiles: ['src/surprise.js'] }));
    agent.approve();
    await assert.rejects(
      () => agent.implement({ patches: [], writes: [{ file: 'src/surprise.js', content: 'unreviewed\n' }] }),
      /approved workspace scope/i,
    );
    assert.equal(existsSync(path.join(repo, 'src', 'surprise.js')), false);
  } finally { cleanup(); }
});

test('Astra stops if an approved file changes underneath her', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    agent.approve();
    // Someone else edits the tree after the plan was made.
    writeFileSync(path.join(repo, 'src', 'sum.js'), 'function sum(a, b) { return a * b; }\n');
    await assert.rejects(
      () => agent.implement({ patches: PATCH }),
      /changed after the plan/,
    );
    assert.match(readFileSync(path.join(repo, 'src', 'sum.js'), 'utf8'), /return a \* b/, 'no edit should be applied');
  } finally {
    cleanup();
  }
});

test('secrets in the repository are never read into the plan', async () => {
  const { agent, cleanup } = selectedLab();
  try {
    const snapshot = await agent.beginTask(plan({ searchHints: ['TOKEN', 'secret'] }));
    const serialised = JSON.stringify(snapshot.plan);
    assert.ok(!serialised.includes('TOKEN=secret'), 'the .env contents must never appear in a plan');
  } finally {
    cleanup();
  }
});

test('review verifies the approved file on disk', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    agent.approve();
    await agent.implement({ patches: PATCH });
    const reviewed = await agent.review();
    assert.equal(reviewed.phase, 'reviewing');
    assert.match(readFileSync(path.join(repo, 'src', 'sum.js'), 'utf8'), /return a \+ b/);
  } finally {
    cleanup();
  }
});

test('cancellation prevents any further tool action', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    agent.approve();
    await agent.cancel('Karl changed his mind');
    assert.equal(agent.snapshot().phase, 'cancelled');
    await assert.rejects(() => agent.implement({ patches: PATCH }), /not been approved|cancelled|scope changed|interrupted/i);
    assert.match(readFileSync(path.join(repo, 'src', 'sum.js'), 'utf8'), /return a - b/);
  } finally {
    cleanup();
  }
});

test('cancellation terminates a running command before reporting', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    writeFileSync(path.join(repo, 'slow.js'), 'setInterval(() => {}, 1000);\n');
    await agent.beginTask(plan({ proposedCommands: [{ executable: 'node', args: ['slow.js'], purpose: 'long running' }] }));
    agent.approve();
    const running = agent.runApprovedCommand('node', ['slow.js']);
    await new Promise((r) => setTimeout(r, 400));
    const cancelled = await agent.cancel('stop it');
    assert.equal(cancelled.phase, 'cancelled');
    // The in-flight command must not keep the promise pending forever.
    await running.catch(() => {});
  } finally {
    cleanup();
  }
});

test('an interrupted task is restored but never resumes without confirmation', async () => {
  const { base, root, repo, db, agent, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    agent.approve();
    await agent.implement({ patches: PATCH });
    const taskId = agent.snapshot().taskId;
    assert.ok(taskId);

    // Simulate a real restart: close the database, reopen it, build a new agent.
    const databaseFile = db.filePath;
    db.close();
    const reopened = new AstraDatabase(databaseFile);
    reopened.migrate();
    const restarted = new CodingAgent({ root }, new ApprovalManager(reopened), new TaskStore(reopened), new MemoryStore(reopened));

    const restored = await restarted.restore(taskId);
    assert.equal(restored.taskId, taskId);
    assert.equal(restored.requiresConfirmation, true, 'an interrupted task must require confirmation');
    assert.equal(restored.phase, 'awaiting_approval', 'a recovered task must not be left in an executable state');
    const note = restored.events.find((e) => e.kind === 'task.restored');
    assert.ok(note, 'recovery must be explained to the user');
    assert.match(note.label, /Nothing resumed|restored for review/i);

    // Even with a recovered task, editing is refused until confirmation.
    await assert.rejects(() => restarted.implement({ patches: PATCH }), /not been approved|interrupted|confirmation/i);
    assert.match(readFileSync(path.join(repo, 'src', 'sum.js'), 'utf8'), /return a \+ b/, 'recovery must not have re-applied anything');

    restarted.confirmResume();
    assert.equal(restarted.snapshot().requiresConfirmation, false);
    restarted.approve();
    assert.equal(await restarted.implementationAlreadyPresent(), true, 'the exact prior patch is recognised');
    const checked = await restarted.runApprovedCommand('node', ['test.js']);
    assert.equal(checked.testResults.at(-1).ok, true, 'resumed checks run only after fresh approval');
    reopened.close();
    void base;
  } finally {
    cleanup();
  }
});

test('a completed task stores a technical summary in memory', async () => {
  const { agent, db, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    agent.approve();
    await agent.implement({ patches: PATCH });
    await agent.runApprovedCommand('node', ['test.js']);
    await agent.complete('fixed the operator');

    const memory = new MemoryStore(db);
    const stored = memory.active();
    assert.equal(stored.length, 1);
    assert.match(stored[0].statement, /DemoApp/);
    assert.match(stored[0].statement, /proposed cause \(model inference\)/i);
    assert.match(stored[0].statement, /tests: 1\/1 passed/);
    assert.ok(stored[0].confidence < 1, 'a stored solution is a lead, not a confirmed fact');
  } finally {
    cleanup();
  }
});

test('selecting a repository refuses anything outside the approved root', async () => {
  const { agent, cleanup } = lab();
  try {
    assert.throws(() => agent.selectRepository('C:\\Windows\\System32'), /path rejected|outside-root/i);
    assert.equal(agent.getRepository(), null);
    agent.selectRepository('DemoApp');
    assert.ok(agent.getRepository().endsWith('DemoApp'));
  } finally {
    cleanup();
  }
});

test('creating a repository refuses to overwrite an existing directory', async () => {
  const { agent, root, cleanup } = selectedLab();
  try {
    const files = { 'package.json': '{"name":"fresh"}' };
    await agent.beginTask(plan({ newRepository: { name: 'Fresh', path: path.join(root, 'Fresh'), files } }));
    agent.approve();
    await agent.createRepository({ name: 'Fresh', files });
    assert.equal(existsSync(path.join(root, 'Fresh', '.git')), false);
    const review = await agent.review();
    assert.equal(review.phase, 'reviewing');
    await assert.rejects(
      () => agent.createRepository({ name: 'Fresh', files }),
      /already exists/i,
    );
  } finally {
    cleanup();
  }
});

test('repository creation is bound to the approved scaffold', async () => {
  const { agent, root, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan({ newRepository: { name: 'Fresh', path: path.join(root, 'Fresh'), files: { 'README.md': '# Fresh\n' } } }));
    agent.approve();
    await assert.rejects(() => agent.createRepository({ name: 'Fresh', files: { 'README.md': '# Replaced\n' } }), /differs from the approved plan/i);
    assert.equal(existsSync(path.join(root, 'Fresh')), false);
  } finally { cleanup(); }
});

test('a second task cannot replace an approved task while it runs', async () => {
  const { agent, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    agent.approve();
    await assert.rejects(() => agent.beginTask(plan({ objective: 'different work' })), /finish, reject or cancel/i);
  } finally { cleanup(); }
});

test('a failed check permits one same-scope correction with renewed approval', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    const first = [{ file: 'src/sum.js', hunks: [{ find: 'return a - b;', replace: 'return a * b;' }] }];
    await agent.beginTask(plan({ proposedPatches: first }));
    agent.approve();
    await agent.implement({ patches: first });
    const failed = await agent.runApprovedCommand('node', ['test.js']);
    assert.equal(failed.testResults.at(-1).ok, false);
    const second = [{ file: 'src/sum.js', hunks: [{ find: 'return a * b;', replace: 'return a + b;' }] }];
    const correction = await agent.proposeCorrection({ rootCause: 'multiplication was also wrong', expectedOutcome: 'sum adds', risks: [], patches: second });
    assert.equal(correction.phase, 'awaiting_approval');
    assert.equal(correction.plan.branch, null);
    await assert.rejects(() => agent.implement({ patches: second }), /not been approved/);
    agent.approve();
    await agent.implement({ patches: second });
    const passed = await agent.runApprovedCommand('node', ['test.js']);
    assert.equal(passed.testResults.at(-1).ok, true);
    assert.match(readFileSync(path.join(repo, 'src', 'sum.js'), 'utf8'), /return a \+ b/);
    await assert.rejects(() => agent.proposeCorrection({ rootCause: 'another', expectedOutcome: 'x', risks: [], patches: second }), /unavailable/);
  } finally { cleanup(); }
});

// ------------------------------------------------------------ chat bridge

test('chat file create, read, edit and delete share CA-01 approval and verified execution', async () => {
  const { agent, root, sandbox, cleanup } = lab();
  const target = path.join(root, 'plain-folder', 'AstraBackstory.js');
  const first = 'export const AstraBackstory = { version: 1 };\n';
  const second = 'export const AstraBackstory = { version: 2 };\n';
  try {
    const bridge = new CodingBridge(agent, sandbox);
    const proposed = await bridge.handle(`Create file ${target} with this content:\n\`\`\`js\n${first.trimEnd()}\n\`\`\``);
    assert.match(proposed.reply, /Nothing has been changed/);
    assert.equal(existsSync(target), false);
    assert.equal(agent.snapshot().phase, 'awaiting_approval');
    assert.throws(() => agent.executeFileOperation(), /not been approved/);
    agent.approve();
    agent.executeFileOperation();
    await agent.review();
    await agent.complete();
    assert.equal(readFileSync(target, 'utf8'), first);
    assert.equal(existsSync(path.join(path.dirname(target), '.git')), false);
    assert.match((await bridge.handle(`Read file ${target}`)).reply, /version: 1/);

    await bridge.handle(`Edit file ${target} with this content:\n\`\`\`js\n${second.trimEnd()}\n\`\`\``);
    assert.equal(readFileSync(target, 'utf8'), first);
    agent.approve();
    agent.executeFileOperation();
    await agent.review();
    await agent.complete();
    assert.equal(readFileSync(target, 'utf8'), second);

    await bridge.handle(`Delete file ${target}`);
    assert.equal(existsSync(target), true);
    assert.throws(() => agent.executeFileOperation(), /not been approved/);
    agent.reject('Karl declined deletion');
    assert.equal(existsSync(target), true);
    await bridge.handle(`Delete file ${target}`);
    agent.approve();
    agent.executeFileOperation();
    await agent.review();
    await agent.complete();
    assert.equal(existsSync(target), false);
  } finally { cleanup(); }
});

test('a rejected deletion is final: no execution, no completion, file untouched', async () => {
  const { agent, root, sandbox, cleanup } = lab();
  const target = path.join(root, 'plain-folder', 'Doomed.js');
  const content = 'export const value = 1;\n';
  try {
    const bridge = new CodingBridge(agent, sandbox);
    await bridge.handle(`Create file ${target} with this content:\n\`\`\`js\n${content.trimEnd()}\n\`\`\``);
    agent.approve();
    agent.executeFileOperation();
    await agent.review();
    await agent.complete();

    const deleteTaskId = (await bridge.handle(`Delete file ${target}`)).snapshot?.taskId;
    assert.equal(agent.snapshot().phase, 'awaiting_approval');
    const rejected = agent.reject('Karl declined deletion');
    assert.equal(rejected.phase, 'cancelled');
    assert.equal(rejected.approval.approved, false, 'a rejection left approval authority behind');
    assert.match(rejected.error ?? '', /rejected/i);
    assert.equal(rejected.events.some((event) => event.kind === 'approval.rejected'), true);
    // Nothing may execute, complete or be re-approved after a rejection.
    assert.throws(() => agent.executeFileOperation(), /rejected/);
    await assert.rejects(() => agent.complete('pretending it worked'), /rejected|cancelled/);
    assert.throws(() => agent.approve(), /rejected|awaiting a fresh approval/);
    assert.equal(agent.snapshot().phase, 'cancelled');
    assert.equal(existsSync(target), true);
    assert.equal(readFileSync(target, 'utf8'), content);
    assert.notEqual(deleteTaskId, null);

    // A fresh request is still possible and behaves normally.
    await bridge.handle(`Delete file ${target}`);
    assert.equal(agent.snapshot().phase, 'awaiting_approval');
    agent.approve();
    agent.executeFileOperation();
    await agent.review();
    await agent.complete();
    assert.equal(existsSync(target), false);
  } finally { cleanup(); }
});

test('a cancelled task can never be reported as completed work', async () => {
  const { agent, repo, cleanup } = selectedLab();
  try {
    await agent.beginTask(plan());
    agent.approve();
    await agent.cancel('Karl withdrew approval');
    assert.equal(agent.snapshot().phase, 'cancelled');
    await assert.rejects(() => agent.complete('completed from the workspace'), /cancelled/);
    assert.equal(agent.snapshot().phase, 'cancelled');
    assert.equal(readFileSync(path.join(repo, 'src', 'sum.js'), 'utf8').includes('a - b'), true);
  } finally { cleanup(); }
});

test('a rejected task stays rejected after a restart', async () => {
  const { agent, root, sandbox, cleanup } = lab();
  const target = path.join(root, 'plain-folder', 'Kept.js');
  const content = 'export const value = 1;\n';
  try {
    const bridge = new CodingBridge(agent, sandbox);
    await bridge.handle(`Create file ${target} with this content:\n\`\`\`js\n${content.trimEnd()}\n\`\`\``);
    agent.approve();
    agent.executeFileOperation();
    await agent.review();
    await agent.complete();
    const taskId = (await bridge.handle(`Delete file ${target}`)).snapshot?.taskId;
    agent.reject('Karl declined deletion');
    await agent.restore(taskId);
    assert.equal(agent.snapshot().phase, 'cancelled');
    assert.throws(() => agent.executeFileOperation(), /rejected|not been approved/);
    await assert.rejects(() => agent.complete(), /rejected|cancelled/);
    assert.equal(readFileSync(target, 'utf8'), content);
  } finally { cleanup(); }
});

test('natural-language JavaScript file is model-authored then bound to approval', async () => {
  const { agent, root, sandbox, cleanup } = lab();
  const target = path.join(root, 'astraBlog', 'AstraBackstory.js');
  const content = "export const AstraBackstory = { purpose: 'help Karl build safely' };\n";
  let calls = 0;
  try {
    const bridge = new CodingBridge(agent, sandbox, proposeFixture, () => false, () => ({ permitted: true, reason: '' }), async (objective, destination, existing) => {
      calls += 1;
      assert.match(objective, /backstory/);
      assert.equal(destination, target);
      assert.equal(existing, null);
      return content;
    });
    const proposed = await bridge.handle('Astra, create a JavaScript file in astraBlog called AstraBackstory.js containing your backstory.');
    assert.equal(calls, 1);
    assert.equal(proposed.snapshot?.plan?.fileOperation?.content, content);
    assert.match(proposed.reply, /Full proposed content/);
    assert.equal(existsSync(target), false);
    assert.throws(() => agent.executeFileOperation(), /not been approved/);
    agent.approve();
    agent.executeFileOperation();
    await agent.review();
    await agent.complete();
    assert.equal(readFileSync(target, 'utf8'), content);
  } finally { cleanup(); }
});

test('natural-language Vue component and README use the selected project and preserve rejection', async () => {
  const { agent, repo, sandbox, cleanup } = selectedLab();
  const component = path.join(repo, 'SettingsPanel.vue');
  try {
    const bridge = new CodingBridge(agent, sandbox, proposeFixture, () => false, () => ({ permitted: true, reason: '' }), async (_objective, target, previous) => {
      if (target === component) { assert.equal(previous, null); return '<template><section>Settings</section></template>\n'; }
      assert.equal(target, path.join(repo, 'README.md'));
      assert.match(previous, /DemoApp/);
      return '# Updated DemoApp\n';
    });
    await bridge.handle('Make a Vue 3 component for a settings panel.');
    assert.equal(existsSync(component), false);
    agent.reject('Karl declined');
    assert.equal(existsSync(component), false);
    await bridge.handle('Make a Vue 3 component for a settings panel.');
    agent.approve();
    agent.executeFileOperation();
    await agent.review();
    await agent.complete();
    assert.match(readFileSync(component, 'utf8'), /<template>/);
    const beforeReadme = readFileSync(path.join(repo, 'README.md'), 'utf8');
    const proposal = await bridge.handle('Write a README explaining this project.');
    assert.match(proposal.reply, /Existing content/);
    assert.equal(readFileSync(path.join(repo, 'README.md'), 'utf8'), beforeReadme);
    agent.approve();
    agent.executeFileOperation();
    await agent.review();
    await agent.complete();
    assert.equal(readFileSync(path.join(repo, 'README.md'), 'utf8'), '# Updated DemoApp\n');
  } finally { cleanup(); }
});

test('generated edit sees current content and fails when that content changes before approval', async () => {
  const { agent, repo, sandbox, cleanup } = selectedLab();
  const target = path.join(repo, 'src', 'sum.js');
  const revised = 'export function sum(a, b) { return a + b; }\n';
  try {
    const bridge = new CodingBridge(agent, sandbox, proposeFixture, () => false, () => ({ permitted: true, reason: '' }), async (_objective, destination, existing) => {
      assert.equal(destination, target);
      assert.match(existing, /return a - b/);
      return revised;
    });
    await bridge.handle(`Replace the contents of this file ${target} with a cleaner implementation.`);
    assert.match(readFileSync(target, 'utf8'), /return a - b/);
    writeFileSync(target, 'external change\n');
    agent.approve();
    assert.throws(() => agent.executeFileOperation(), /changed since planning/);
    assert.equal(readFileSync(target, 'utf8'), 'external change\n');
  } finally { cleanup(); }
});

test('the chat bridge lists repositories and never invokes the model', async () => {
  const { agent, sandbox, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    const listed = await bridge.handle('Show me my repositories');
    assert.ok(listed);
    assert.equal(listed.handled, true);
    assert.match(listed.reply, /DemoApp/);
  } finally {
    cleanup();
  }
});

test('ordinary conversation is left to the language model', async () => {
  const { agent, sandbox, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    assert.equal(await bridge.handle('Hi Astra'), null);
    assert.equal(await bridge.handle('Tell me a joke'), null);
  } finally {
    cleanup();
  }
});

test('opening a repository by name matches a real discovered repository', async () => {
  const { agent, sandbox, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    const result = await bridge.handle('Open DemoApp');
    assert.match(result.reply, /Selected \*\*DemoApp\*\*/);
    assert.match(result.reply, /Nothing has been changed/);
  } finally {
    cleanup();
  }
});

test('a fix request produces a plan and changes nothing', async () => {
  const { agent, repo, sandbox, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox, proposeFixture);
    const result = await bridge.handle('Fix the bug in DemoApp');
    assert.match(result.reply, /Approval required|Nothing has been changed/);
    assert.match(readFileSync(path.join(repo, 'src', 'sum.js'), 'utf8'), /return a - b/);
  } finally {
    cleanup();
  }
});

test('an unknown repository name is reported, not guessed', async () => {
  const { agent, sandbox, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    const result = await bridge.handle('Open NoSuchRepo');
    assert.match(result.reply, /No repository called "NoSuchRepo"/);
    assert.equal(agent.getRepository(), null);
  } finally {
    cleanup();
  }
});

test('search results come from the real repository contents', async () => {
  const { agent, sandbox, cleanup } = lab();
  try {
    const bridge = new CodingBridge(agent, sandbox);
    await bridge.handle('Open DemoApp');
    const result = await bridge.handle('Find where sum is implemented');
    assert.match(result.reply, /sum\.js/);
    assert.ok(!result.reply.includes('TOKEN=secret'), 'secrets must never be surfaced');
  } finally {
    cleanup();
  }
});

test('the React TypeScript scaffold declares dependencies without installing them', () => {
  const files = buildScaffold('MyDashboard', ['React', 'TypeScript']);
  assert.ok(files['package.json']);
  assert.ok(files['src/main.tsx']);
  assert.ok(files['src/App.tsx']);
  assert.equal(JSON.parse(files['package.json']).dependencies.react, '^19.3.0');
  assert.match(files['README.md'], /not installed/i);
});

test('search hints are extracted from a natural-language request', () => {
  assert.deepEqual(extractSearchHints('Find where authentication is implemented'), ['authentication']);
  assert.deepEqual(extractSearchHints('fix the "loginValidator" function'), ['loginValidator']);
  assert.deepEqual(extractSearchHints('investigate the failing tests'), []);
});
