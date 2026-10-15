import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { planDirectFileAction, executeDirectFileAction, readDirectFile } = require('../dist-electron/main/workspace/fileTools.js');
const { extractAbsoluteFilePath, routeCodingIntent } = require('../dist-electron/main/agent/codingIntent.js');

function fixture(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'astra-direct-file-'));
  try { return run({ root, sandbox: { root }, target: path.join(root, 'astraBlog', 'AstraBackstory.js') }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('ordinary file requests route to trusted tools with the exact absolute path', () => {
  const target = 'C:\\Users\\karlr\\repos\\astraBlog\\AstraBackstory.js';
  for (const [verb, kind] of [['Create', 'create_file'], ['Read', 'read_file'], ['Edit', 'edit_file'], ['Delete', 'delete_file']]) {
    const request = `${verb} file ${target}`;
    assert.equal(routeCodingIntent(request).kind, kind);
    assert.equal(extractAbsoluteFilePath(request), target);
  }
  assert.equal(routeCodingIntent('Create a new Git repository called AstraStone.').kind, 'create_repository');
  assert.equal(routeCodingIntent(`Does the file ${target} exist?`).kind, 'read_file');
  assert.equal(routeCodingIntent('Make a Vue 3 component for a settings panel.').kind, 'create_file');
  assert.equal(routeCodingIntent('Write a README explaining this project.').kind, 'write_file');
  assert.equal(routeCodingIntent('Create a Laravel controller for managing profiles.').kind, 'create_file');
  assert.equal(routeCodingIntent('Update this function to handle validation errors.').kind, 'edit_file');
  assert.equal(routeCodingIntent('Replace the contents of this file with a cleaner implementation.').kind, 'edit_file');
});

test('approved create makes only the named directory and file, then verifies exact bytes', () => fixture(({ root, sandbox, target }) => {
  const content = "export const AstraBackstory = { name: 'Astra' };\n";
  const plan = planDirectFileAction(target, sandbox, 'create', content);
  assert.equal(plan.createParent, true);
  assert.equal(existsSync(target), false);
  const result = executeDirectFileAction(plan, sandbox);
  assert.equal(result.target, target);
  assert.equal(result.bytes, Buffer.byteLength(content));
  assert.equal(readFileSync(target, 'utf8'), content);
  assert.equal(readDirectFile(target, sandbox).sha256, result.sha256);
  assert.equal(existsSync(path.join(root, 'astraBlog', '.git')), false);
}));

test('approved edit and delete check the planned version and verify the result', () => fixture(({ sandbox, target }) => {
  const initial = 'export const value = 1;\n';
  executeDirectFileAction(planDirectFileAction(target, sandbox, 'create', initial), sandbox);
  const edit = planDirectFileAction(target, sandbox, 'edit', 'export const value = 2;\n');
  executeDirectFileAction(edit, sandbox);
  assert.equal(readDirectFile(target, sandbox).content, 'export const value = 2;\n');
  const remove = planDirectFileAction(target, sandbox, 'delete');
  executeDirectFileAction(remove, sandbox);
  assert.equal(existsSync(target), false);
}));

test('missing files, occupied creates and changed files fail without overwriting', () => fixture(({ sandbox, target }) => {
  assert.throws(() => readDirectFile(target, sandbox), /does not exist/);
  assert.throws(() => planDirectFileAction(target, sandbox, 'edit', 'x'), /does not exist/);
  const plan = planDirectFileAction(target, sandbox, 'create', 'first\n');
  executeDirectFileAction(plan, sandbox);
  assert.throws(() => planDirectFileAction(target, sandbox, 'create', 'second\n'), /already exists/);
  const edit = planDirectFileAction(target, sandbox, 'edit', 'second\n');
  writeFileSync(target, 'external change\n');
  assert.throws(() => executeDirectFileAction(edit, sandbox), /changed since planning/);
  assert.equal(readFileSync(target, 'utf8'), 'external change\n');
}));

test('a stale delete plan is refused and the changed file is preserved', () => fixture(({ sandbox, target }) => {
  const initial = 'export const value = 1;\n';
  executeDirectFileAction(planDirectFileAction(target, sandbox, 'create', initial), sandbox);
  const staleDelete = planDirectFileAction(target, sandbox, 'delete');
  writeFileSync(target, 'changed after planning\n');
  assert.throws(() => executeDirectFileAction(staleDelete, sandbox), /changed since planning/);
  assert.equal(readFileSync(target, 'utf8'), 'changed after planning\n');
  executeDirectFileAction(planDirectFileAction(target, sandbox, 'delete'), sandbox);
  assert.equal(existsSync(target), false);
}));

test('permission failures and readback mismatches never report verified success', () => fixture(({ sandbox, target }) => {
  const plan = planDirectFileAction(target, sandbox, 'create', 'approved\n');
  assert.throws(() => executeDirectFileAction(plan, sandbox, { write() { const error = new Error('blocked'); error.code = 'EACCES'; throw error; } }), /permission denied/);
  assert.equal(existsSync(target), false);
  assert.throws(() => executeDirectFileAction(plan, sandbox, { write(file) { writeFileSync(file, 'wrong\n'); } }), /verification failed/);
  assert.equal(readFileSync(target, 'utf8'), 'wrong\n');
}));

test('an approved digest mismatch reports the observed file state, not success or rollback', () => fixture(({ sandbox, target }) => {
  const plan = planDirectFileAction(target, sandbox, 'create', 'approved\n');
  assert.throws(() => executeDirectFileAction({ ...plan, expectedSha256: '0'.repeat(64) }, sandbox), /observed 9 bytes, SHA-256 .*file may remain on disk/);
  assert.equal(readFileSync(target, 'utf8'), 'approved\n');
}));

test('path escape and sensitive directories are refused before planning', () => fixture(({ root, sandbox }) => {
  assert.throws(() => planDirectFileAction(path.resolve(root, '..', 'outside.js'), sandbox, 'create', 'x'), /outside-root/);
  assert.throws(() => planDirectFileAction(path.join(root, '.git', 'config'), sandbox, 'create', 'x'), /not permitted/);
  assert.throws(() => planDirectFileAction(path.join(root, '.GIT', 'config'), sandbox, 'create', 'x'), /not permitted/);
  assert.throws(() => planDirectFileAction(path.join(root, '.ENV'), sandbox, 'create', 'x'), /not permitted/);
  assert.throws(() => planDirectFileAction(path.join(root, 'secrets.pem'), sandbox, 'create', 'x'), /not permitted/);
}));
