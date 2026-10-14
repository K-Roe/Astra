import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { AstraDatabase } = require('../dist-electron/main/knowledge/database.js');
const { TaskStore, TaskTransitionError } = require('../dist-electron/main/agent/taskStore.js');
const { routeTask, summarizeBenchmark, BENCHMARK_CASES, MIN_CODING_RELIABILITY, CONVERSATION_MODEL, CODING_MODEL } = require('../dist-electron/main/models/codingBenchmark.js');

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'astra-task-'));
  const db = new AstraDatabase(path.join(dir, 'astra.db'));
  db.migrate();
  return { dir, db, tasks: new TaskStore(db) };
}

// ------------------------------------------------------------ task store

test('a task moves through the approved lifecycle and records events', () => {
  const { dir, db, tasks } = fresh();
  try {
    const task = tasks.create({ repo: 'C:\\repos\\Demo', objective: 'Add a greeting function' });
    assert.equal(task.state, 'draft');

    for (const next of ['investigating', 'planning', 'awaiting_approval', 'implementing', 'testing', 'reviewing', 'completed']) {
      const updated = tasks.transition(task.id, next);
      assert.equal(updated.state, next);
    }
    const events = tasks.events(task.id);
    assert.ok(events.length >= 8, 'every transition is recorded');
    assert.equal(tasks.active(), undefined, 'a completed task is no longer active');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('illegal transitions are refused', () => {
  const { dir, db, tasks } = fresh();
  try {
    const task = tasks.create({ repo: 'C:\\repos\\Demo', objective: 'x' });
    assert.throws(() => tasks.transition(task.id, 'completed'), TaskTransitionError);
    assert.throws(() => tasks.transition(task.id, 'testing'), TaskTransitionError);
    assert.equal(tasks.get(task.id).state, 'draft');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('work is only executable in implementing and testing, after confirmation', () => {
  const { dir, db, tasks } = fresh();
  try {
    const task = tasks.create({ repo: 'C:\\repos\\Demo', objective: 'x' });
    assert.equal(tasks.mayExecute(tasks.get(task.id)), false, 'a draft task must not execute');

    tasks.transition(task.id, 'investigating');
    tasks.transition(task.id, 'planning');
    tasks.transition(task.id, 'awaiting_approval');
    tasks.transition(task.id, 'implementing');
    assert.equal(tasks.mayExecute(tasks.get(task.id)), true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancelling stops executable work immediately', () => {
  const { dir, db, tasks } = fresh();
  try {
    const task = tasks.create({ repo: 'C:\\repos\\Demo', objective: 'x' });
    for (const s of ['investigating', 'planning', 'awaiting_approval', 'implementing']) tasks.transition(task.id, s);
    assert.equal(tasks.mayExecute(tasks.get(task.id)), true);

    const cancelled = tasks.cancel(task.id, 'Karl changed his mind');
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(tasks.mayExecute(cancelled), false);
    assert.throws(() => tasks.transition(task.id, 'testing'), TaskTransitionError);
    assert.throws(() => tasks.confirmResume(task.id), /cannot be resumed/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a restart recovers the task but refuses to resume work without confirmation', () => {
  const { dir, db, tasks } = fresh();
  try {
    const file = db.filePath;
    const task = tasks.create({ repo: 'C:\\repos\\Demo', objective: 'Fix the parser' });
    for (const s of ['investigating', 'planning', 'awaiting_approval', 'implementing']) tasks.transition(task.id, s);
    assert.equal(tasks.mayExecute(tasks.get(task.id)), true);
    db.close();

    // Simulate an application restart.
    const reopened = new AstraDatabase(file);
    reopened.migrate();
    const restored = new TaskStore(reopened);

    const recovered = restored.recoverOnStartup();
    assert.equal(recovered.length, 1, 'the interrupted task is surfaced');
    assert.equal(recovered[0].requiresConfirm, true);
    assert.equal(recovered[0].state, 'implementing', 'the state is preserved for context');
    assert.equal(restored.mayExecute(recovered[0]), false, 'no executable work may resume automatically');
    assert.match(String(recovered[0].recovery.note), /restarted/i);

    const confirmed = restored.confirmResume(task.id);
    assert.equal(confirmed.requiresConfirm, false);
    assert.equal(confirmed.state, 'awaiting_approval');
    assert.equal(restored.mayExecute(confirmed), false, 'the plan still needs fresh approval');
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recovery leaves finished tasks alone and is idempotent', () => {
  const { dir, db, tasks } = fresh();
  try {
    const done = tasks.create({ repo: 'C:\\repos\\A', objective: 'done' });
    for (const s of ['investigating', 'planning', 'awaiting_approval', 'implementing', 'testing', 'reviewing', 'completed']) {
      tasks.transition(done.id, s);
    }
    assert.deepEqual(tasks.recoverOnStartup(), [], 'a completed task needs no recovery');
    assert.deepEqual(tasks.recoverOnStartup(), [], 'a second call finds nothing to do');
    assert.equal(tasks.get(done.id).requiresConfirm, false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scope, plan, changes and test results persist across a restart', () => {
  const { dir, db, tasks } = fresh();
  try {
    const file = db.filePath;
    const task = tasks.create({ repo: 'C:\\repos\\Demo', objective: 'x' });
    tasks.setPlan(task.id, { steps: ['read', 'edit'] });
    tasks.setScope(task.id, { files: ['src/a.ts'], repo: 'Demo' });
    tasks.recordChange(task.id, { file: 'src/a.ts', action: 'patch', applied: 1 });
    tasks.recordTestResult(task.id, { command: 'npm test', ok: false, exitCode: 1 });
    db.close();

    const reopened = new AstraDatabase(file);
    reopened.migrate();
    const restored = new TaskStore(reopened).get(task.id);
    assert.deepEqual(restored.plan.steps, ['read', 'edit']);
    assert.deepEqual(restored.scope.files, ['src/a.ts']);
    assert.equal(restored.changes.length, 1);
    assert.equal(restored.testResults[0].ok, false);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------- routing

test('conversation always stays on Gemma', () => {
  assert.equal(routeTask('conversation').model, CONVERSATION_MODEL);
  assert.equal(routeTask('conversation').permitted, true);
  assert.equal(routeTask('research').model, CONVERSATION_MODEL);
});

test('coding work is refused until reliability is measured above the threshold', () => {
  const unmeasured = routeTask('coding');
  assert.equal(unmeasured.model, CODING_MODEL);
  assert.equal(unmeasured.permitted, false, 'an unmeasured coding model must not be trusted');
  assert.match(unmeasured.reason, /below the/);

  const weak = routeTask('coding', { codingReliability: 0.4 });
  assert.equal(weak.permitted, false);

  const good = routeTask('coding', { codingReliability: 0.8 });
  assert.equal(good.permitted, true);
  assert.equal(good.model, CODING_MODEL);
});

test('the benchmark scores objectively and refuses to overstate capability', () => {
  const allPass = BENCHMARK_CASES.map((c) => ({ id: c.id, skill: c.skill, passed: true, output: '', durationMs: 1 }));
  const nonePass = BENCHMARK_CASES.map((c) => ({ id: c.id, skill: c.skill, passed: false, output: '', durationMs: 1 }));

  const perfect = summarizeBenchmark(CODING_MODEL, allPass);
  assert.equal(perfect.reliability, 1);
  assert.equal(perfect.usableForCoding, true);

  const useless = summarizeBenchmark(CODING_MODEL, nonePass);
  assert.equal(useless.reliability, 0);
  assert.equal(useless.usableForCoding, false);
  assert.match(useless.note, /must not claim reliable autonomous coding/);

  const half = summarizeBenchmark(CODING_MODEL, allPass.map((r, i) => ({ ...r, passed: i % 2 === 0 })));
  assert.ok(Math.abs(half.reliability - 0.5) < 0.001);
  assert.equal(half.usableForCoding, false);
  assert.equal(half.passed, Math.ceil(BENCHMARK_CASES.length / 2));
});

test('benchmark expectations reject plausible but wrong answers', () => {
  const typeCase = BENCHMARK_CASES.find((c) => c.id === 'ts-type-error');
  assert.equal(typeCase.expect('const total: number = 1 + 2;'), true);
  assert.equal(typeCase.expect('const total: string = 1 + 2;'), false, 'the original error must not pass');
  assert.equal(typeCase.expect('Change the type to Number'), false, 'prose is not a corrected line');

  const toolCase = BENCHMARK_CASES.find((c) => c.id === 'structured-tool-call');
  assert.equal(toolCase.expect('{"tool":"read_file","path":"README.md"}'), true);
  assert.equal(toolCase.expect('I will read README.md'), false);
  assert.equal(toolCase.expect('{"tool":"run_command","path":"README.md"}'), false);
});

test('the routing threshold is a single documented number', () => {
  assert.equal(MIN_CODING_RELIABILITY, 0.6);
});
