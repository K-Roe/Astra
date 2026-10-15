import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  discoverRepositories, describeProject, listProjectFiles, readProjectFile,
  searchProjectCode, suggestTestCommands,
} = require('../dist-electron/main/workspace/repoTools.js');
const {
  writeProjectFile, applyPatch, deleteProjectFile, runGit,
  ensureNewRepositoryDirectory, FileToolError,
} = require('../dist-electron/main/workspace/fileTools.js');
const {
  assertCommandAllowed, runApprovedCommand, CommandRejected, DEFAULT_COMMAND_POLICY,
} = require('../dist-electron/main/workspace/commandRunner.js');

/** A throwaway sandbox that is NOT one of Karl's real projects. */
function sandboxWithRepo(name = 'TestRepo') {
  const base = mkdtempSync(path.join(tmpdir(), 'astra-ws-'));
  const root = path.join(base, 'repos');
  const repo = path.join(root, name);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'test-repo', description: 'A test project' }, null, 2));
  writeFileSync(path.join(repo, 'README.md'), '# Test Repo\n\nA controlled test project.\n');
  writeFileSync(path.join(repo, 'src', 'index.js'), 'export function add(a, b) {\n  return a - b;\n}\n');
  writeFileSync(path.join(repo, '.env'), 'SECRET=should-never-be-read\n');
  writeFileSync(path.join(repo, 'id_rsa'), '-----BEGIN PRIVATE KEY-----\n');
  mkdirSync(path.join(repo, 'node_modules', 'junk'), { recursive: true });
  writeFileSync(path.join(repo, 'node_modules', 'junk', 'big.js'), 'x'.repeat(100));
  return { base, root, repo, sandbox: { root }, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

// ------------------------------------------------------------- discovery

test('repositories are discovered under the root and metadata is read', () => {
  const { cleanup, root, sandbox } = sandboxWithRepo();
  try {
    const repos = discoverRepositories(sandbox);
    assert.equal(repos.length, 1);
    assert.equal(repos[0].name, 'TestRepo');
    assert.equal(repos[0].hasGit, false);
    assert.equal(repos[0].description, 'A test project');
    assert.ok(repos[0].detectedLanguages.includes('JavaScript'));
    assert.ok(repos[0].root.startsWith(root));
  } finally {
    cleanup();
  }
});

test('discovery skips dependency and hidden directories', () => {
  const { cleanup, sandbox } = sandboxWithRepo();
  try {
    mkdirSync(path.join(sandbox.root, 'node_modules'), { recursive: true });
    writeFileSync(path.join(sandbox.root, 'package.json'), '{}');
    const repos = discoverRepositories(sandbox);
    assert.equal(repos.length, 1, 'node_modules must not be treated as a repository');
  } finally {
    cleanup();
  }
});

test('listing files honours ignore rules and never exposes secrets', () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    const files = listProjectFiles(repo, sandbox).map((f) => f.relativePath);
    assert.ok(files.includes('src\\index.js') || files.includes('src/index.js'));
    assert.ok(!files.some((f) => f.includes('node_modules')), 'node_modules must be ignored');
    assert.ok(!files.some((f) => f.includes('.env')), '.env must never be listed');
    assert.ok(!files.some((f) => f.includes('id_rsa')), 'private keys must never be listed');
  } finally {
    cleanup();
  }
});

test('reading a secret file is refused', () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    assert.throws(() => readProjectFile(path.join(repo, '.env'), sandbox), /credential or secret/);
    assert.throws(() => readProjectFile(path.join(repo, 'id_rsa'), sandbox), /credential or secret/);
  } finally {
    cleanup();
  }
});

test('reading a normal file works and reports truncation', () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    const result = readProjectFile(path.join(repo, 'src', 'index.js'), sandbox);
    assert.match(result.text, /export function add/);
    assert.equal(result.truncated, false);
    const small = readProjectFile(path.join(repo, 'README.md'), sandbox, { maxBytes: 5 });
    assert.equal(small.truncated, true);
  } finally {
    cleanup();
  }
});

test('code search finds matches without reading secrets', () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    const hits = searchProjectCode(repo, sandbox, 'return a');
    assert.ok(hits.length >= 1);
    assert.match(hits[0].relativePath, /index\.js/);
    assert.equal(hits[0].line, 2);
  } finally {
    cleanup();
  }
});

test('test commands are suggested from project metadata only', () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    assert.deepEqual(suggestTestCommands(repo, sandbox), ['npm test']);
  } finally {
    cleanup();
  }
});

test('a project description includes frameworks and file count', () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    const described = describeProject(repo, sandbox);
    assert.ok(described.frameworks.includes('Node'));
    assert.ok(described.fileCount > 0);
  } finally {
    cleanup();
  }
});

// ----------------------------------------------------------- file edits

test('writing, patching and deleting inside the sandbox works', () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    const written = writeProjectFile(repo, sandbox, 'src/new.js', 'export const x = 1;\n');
    assert.equal(written.created, true);
    assert.ok(existsSync(path.join(repo, 'src', 'new.js')));

    const patched = applyPatch(repo, sandbox, 'src/index.js', [{ find: 'return a - b;', replace: 'return a + b;' }]);
    assert.equal(patched.patch.applied, 1);
    assert.match(readProjectFile(path.join(repo, 'src', 'index.js'), sandbox).text, /return a \+ b/);

    const deleted = deleteProjectFile(repo, sandbox, 'src/new.js');
    assert.match(deleted.relativePath, /new\.js/);
    assert.equal(existsSync(path.join(repo, 'src', 'new.js')), false);
  } finally {
    cleanup();
  }
});

test('a patch that does not match is reported and changes nothing', () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    const before = readProjectFile(path.join(repo, 'src', 'index.js'), sandbox).text;
    const result = applyPatch(repo, sandbox, 'src/index.js', [{ find: 'this text is not there', replace: 'x' }]);
    assert.equal(result.patch.applied, 0);
    assert.equal(result.patch.failed.length, 1);
    assert.match(result.patch.failed[0].reason, /not found/);
    assert.equal(readProjectFile(path.join(repo, 'src', 'index.js'), sandbox).text, before, 'a failed patch must not alter the file');
  } finally {
    cleanup();
  }
});

test('an ambiguous patch is refused rather than guessed', () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    writeProjectFile(repo, sandbox, 'dup.js', 'const a = 1;\nconst a = 1;\n');
    const result = applyPatch(repo, sandbox, 'dup.js', [{ find: 'const a = 1;', replace: 'const a = 2;' }]);
    assert.equal(result.patch.applied, 0);
    assert.match(result.patch.failed[0].reason, /ambiguous/);
  } finally {
    cleanup();
  }
});

test('editing outside the repository or escaping the root is refused', () => {
  const { cleanup, repo, sandbox, base } = sandboxWithRepo();
  try {
    assert.throws(() => writeProjectFile(repo, sandbox, '../escaped.js', 'x'), /outside-root/);
    assert.throws(() => writeProjectFile(repo, sandbox, '..\\..\\..\\escaped.js', 'x'), /outside-root/);
    assert.throws(() => writeProjectFile(repo, sandbox, path.join(base, 'outside.js'), 'x'), /outside-root/);
    assert.equal(existsSync(path.join(base, 'outside.js')), false);
  } finally {
    cleanup();
  }
});

test('the repository root itself cannot be overwritten as a file', () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    assert.throws(() => writeProjectFile(repo, sandbox, '.', 'x'), /is-root|outside-root/);
  } finally {
    cleanup();
  }
});

test('creating a new repository directory refuses an existing non-empty one', () => {
  const { cleanup, sandbox } = sandboxWithRepo();
  try {
    const fresh = path.join(sandbox.root, 'BrandNew');
    ensureNewRepositoryDirectory(fresh, sandbox);
    assert.ok(existsSync(fresh));
    assert.throws(() => ensureNewRepositoryDirectory(path.join(sandbox.root, 'TestRepo'), sandbox), FileToolError);
  } finally {
    cleanup();
  }
});

// ------------------------------------------------------------------ git

test('Git helper refuses commands without executing them', async () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    const result = await runGit(repo, sandbox, ['status']);
    assert.equal(result.ok, false);
    assert.match(result.stderr, /disabled/i);
  } finally {
    cleanup();
  }
});

// ------------------------------------------------------------- commands

test('only allowlisted executables may run', () => {
  const policy = DEFAULT_COMMAND_POLICY;
  assertCommandAllowed({ executable: 'npm', args: ['test'], cwd: 'C:\\x', purpose: 'tests' }, policy);
  assert.throws(() => assertCommandAllowed({ executable: 'powershell', args: ['-Command', 'x'], cwd: 'C:\\x', purpose: 'x' }, policy), CommandRejected);
  assert.throws(() => assertCommandAllowed({ executable: 'curl', args: ['http://x'], cwd: 'C:\\x', purpose: 'x' }, policy), CommandRejected);
  assert.throws(() => assertCommandAllowed({ executable: 'rm', args: ['-rf', '/'], cwd: 'C:\\x', purpose: 'x' }, policy), CommandRejected);
});

test('installing dependencies is never allowed through the runner', () => {
  for (const args of [['install'], ['i'], ['add', 'left-pad'], ['ci']]) {
    assert.throws(() => assertCommandAllowed({ executable: 'npm', args, cwd: 'C:\\x', purpose: 'x' }), CommandRejected, args.join(' '));
  }
});

test('inline code execution and shell metacharacters are refused', () => {
  assert.throws(() => assertCommandAllowed({ executable: 'node', args: ['-e', 'process.exit(1)'], cwd: 'C:\\x', purpose: 'x' }), CommandRejected);
  assert.throws(() => assertCommandAllowed({ executable: 'node', args: ['--eval', 'x'], cwd: 'C:\\x', purpose: 'x' }), CommandRejected);
  assert.throws(() => assertCommandAllowed({ executable: 'npm', args: ['test', '&&', 'del', 'x'], cwd: 'C:\\x', purpose: 'x' }), CommandRejected);
  assert.throws(() => assertCommandAllowed({ executable: 'npm', args: ['test', '|', 'more'], cwd: 'C:\\x', purpose: 'x' }), CommandRejected);
});

test('an unknown package script is refused', () => {
  assert.throws(() => assertCommandAllowed({ executable: 'npm', args: ['run', 'publish'], cwd: 'C:\\x', purpose: 'x' }), CommandRejected);
});

test('an approved command runs in the repository and returns real output', async () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    writeFileSync(
      path.join(repo, 'check.js'),
      "console.log('astra-command-ok'); process.exit(0);\n",
    );
    const result = await runApprovedCommand(
      { executable: 'node', args: ['check.js'], cwd: repo, purpose: 'verify the runner works' },
      sandbox,
    );
    assert.equal(result.ok, true);
    assert.match(result.stdout, /astra-command-ok/);
    assert.equal(result.code, 0);
  } finally {
    cleanup();
  }
});

test('a failing command reports its exit code and stderr rather than throwing', async () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    writeFileSync(path.join(repo, 'fail.js'), "console.error('boom'); process.exit(3);\n");
    const result = await runApprovedCommand(
      { executable: 'node', args: ['fail.js'], cwd: repo, purpose: 'check failure handling' },
      sandbox,
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, 3);
    assert.match(result.stderr, /boom/);
  } finally {
    cleanup();
  }
});

test('a command cannot run outside the authorised repository', async () => {
  const { cleanup, sandbox, base } = sandboxWithRepo();
  try {
    await assert.rejects(
      () => runApprovedCommand({ executable: 'node', args: ['-v'], cwd: path.join(base, '..'), purpose: 'escape' }, sandbox),
      /path rejected/,
    );
  } finally {
    cleanup();
  }
});

test('a hung command is killed at the timeout', async () => {
  const { cleanup, repo, sandbox } = sandboxWithRepo();
  try {
    writeFileSync(path.join(repo, 'hang.js'), 'setInterval(() => {}, 1000);\n');
    const result = await runApprovedCommand(
      { executable: 'node', args: ['hang.js'], cwd: repo, purpose: 'timeout check', timeoutMs: 1200 },
      sandbox,
    );
    assert.equal(result.timedOut, true);
    assert.equal(result.ok, false);
  } finally {
    cleanup();
  }
});
