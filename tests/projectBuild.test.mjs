import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AstraDatabase } = require('../dist-electron/main/knowledge/database.js');
const { ApprovalManager } = require('../dist-electron/main/approvals/approvalManager.js');
const { TaskStore } = require('../dist-electron/main/agent/taskStore.js');
const { MemoryStore } = require('../dist-electron/main/knowledge/memoryStore.js');
const { CodingAgent, scopeFingerprint } = require('../dist-electron/main/agent/codingAgent.js');
const { CodingBridge } = require('../dist-electron/main/agent/codingBridge.js');
const {
  analyseProjectRequest, buildProjectScaffold, validateGeneratedFiles,
} = require('../dist-electron/main/agent/projectBuild.js');
const {
  grantProjectAuthority, resolveAuthorisedWrite, writeAuthorised, AuthorityRefused, requiresSeparateApproval,
} = require('../dist-electron/main/workspace/projectAuthority.js');
const { extractNewRepositoryName, routeCodingIntent } = require('../dist-electron/main/agent/codingIntent.js');

/**
 * Karl asks for a whole project in one sentence, approves its scope once, and
 * Astra builds and verifies it.
 *
 * Everything runs in a temporary directory; Karl's repositories are untouched.
 */

function lab() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'astra-project-'));
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

/** The request Karl is defined to make. */
const REQUEST = "Create a new repository called Astra's Blog and build me a working blog website.";

/** A bridge whose model calls always fail, so the baseline is tested alone. */
function offlineBridge(agent, sandbox) {
  return new CodingBridge(
    agent, sandbox,
    undefined, () => false,
    () => ({ permitted: false, reason: 'benchmark below threshold' }),
  );
}

// ------------------------------------------------------- understanding

test('the request is understood without Karl supplying files or code', () => {
  assert.equal(extractNewRepositoryName(REQUEST), "Astra's Blog");
  const request = analyseProjectRequest(REQUEST, 'AstrasBlog');
  assert.equal(request.kind, 'blog');
  assert.equal(request.buildsApplication, true);
  assert.match(request.purpose, /blog website/i);
  // The stack is recorded as a preference; it never implies an installation.
  assert.ok(Array.isArray(request.stack));
  assert.ok(request.limits.maxIterations >= 1 && request.limits.maxWrites >= 1);
});

test('a bare scaffold request is not treated as an application build', () => {
  const request = analyseProjectRequest('Create a new repository called Plain', 'Plain');
  assert.equal(request.buildsApplication, false);
});

test('the spoken name stops at a clause boundary', () => {
  // Truncating less would propose AstrasBlogAndBuildMeWorkingBlogWebsite.
  assert.equal(extractNewRepositoryName(REQUEST), "Astra's Blog");
  assert.equal(extractNewRepositoryName('create a blog called BlogTarget at http://localhost:3000'), 'BlogTarget');
  assert.equal(extractNewRepositoryName('create a repository called My Blog'), 'My Blog');
});

// ---------------------------------------------------------- the scaffold

test('the baseline project is real, dependency-free code that passes its own tests', () => {
  const files = buildProjectScaffold('AstrasBlog', 'blog');
  assert.ok(files['src/server.js'].includes("require('node:http')"), 'the server must be real');
  assert.ok(files['test/posts.test.js'].includes("require('node:test')"), 'the tests must be real');
  const pkg = JSON.parse(files['package.json']);
  assert.deepEqual(pkg.dependencies, undefined, 'the project must need no installation');
  assert.equal(pkg.scripts.test, 'node --test');

  // Prove it on disk rather than trusting the strings.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'astra-scaffold-check-'));
  try {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(dir, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }
// `node --test` writes its summary to stderr, so both streams are read.
    // NODE_TEST_CONTEXT is stripped: it makes a nested run skip its own files.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync('node', ['--test'], { cwd: dir, encoding: 'utf8', env });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(`${run.stdout}${run.stderr}`, /fail 0/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('generated files are validated against the approved manifest', () => {
  const manifest = ['src/a.js', 'src/b.js'];
  const good = validateGeneratedFiles({ 'src/a.js': 'x' }, manifest);
  assert.deepEqual(Object.keys(good), ['src/a.js']);
// A path outside the manifest, a traversal and an absolute path are all refused.
  for (const bad of [{ 'src/evil.js': 'x' }, { '../../etc/passwd': 'x' }, { 'C:/Windows/x.js': 'x' }]) {
    assert.throws(() => validateGeneratedFiles(bad, manifest), /not in the approved file list|disallowed/i);
  }
  assert.throws(() => validateGeneratedFiles({ 'src/a.js': '' }, manifest), /no content/i);
  assert.throws(() => validateGeneratedFiles({ 'src/a.js': 42 }, manifest), /no content/i);
  // An approved path with an executable extension is still refused.
  assert.throws(() => validateGeneratedFiles({ 'src/a.exe': 'x' }, ['src/a.exe']), /disallowed extension/i);
  assert.throws(() => validateGeneratedFiles('nope', manifest), /file map/i);
});

// ------------------------------------------------------------- authority

test('authority is only ever granted over a directory that does not exist', () => {
  const { root, sandbox, cleanup } = lab();
  try {
    const fresh = path.join(root, 'New');
    const authority = grantProjectAuthority(fresh, sandbox, 10, 5000);
    assert.equal(authority.root, fresh);
// An existing directory — i.e. anything of Karl's — can never be granted.
    // pathGuard refuses the root itself; the grant refuses anything else present.
    assert.throws(() => grantProjectAuthority(root, sandbox, 10, 5000), (error) => {
      assert.ok(error instanceof AuthorityRefused || error?.name === 'PathRejected', `unexpected refusal: ${error}`);
      return true;
    });
    mkdirSync(path.join(root, 'Existing'), { recursive: true });
    assert.throws(() => grantProjectAuthority(path.join(root, 'Existing'), sandbox, 10, 5000), AuthorityRefused);
    assert.throws(() => grantProjectAuthority(path.join(root, 'Missing', 'Deep'), sandbox, 10, 5000), AuthorityRefused);
    // Outside the sandbox entirely: pathGuard refuses first.
    assert.throws(() => grantProjectAuthority('C:\\Windows', sandbox, 10, 5000), (error) => {
      assert.ok(error instanceof AuthorityRefused || error?.name === 'PathRejected', `unexpected refusal: ${error}`);
      return true;
    });
  } finally { cleanup(); }
});

test('authority cannot reach outside the project, into secrets, or over budget', () => {
  const { root, sandbox, cleanup } = lab();
  try {
    const authority = grantProjectAuthority(path.join(root, 'New'), sandbox, 2, 5000);
    mkdirSync(authority.root, { recursive: true });
    writeAuthorised(authority, 'src/a.js', 'x');
    writeAuthorised(authority, 'src/b.js', 'y');
    assert.equal(authority.writesUsed, 2);

    for (const hostile of [
      '../outside.js', '../../etc/passwd', 'C:/Windows/system32/x.js',
      'src\\..\\..\\outside.js', '.env', 'config/secrets.json', 'id_rsa',
      'node_modules/pkg/index.js', '.git/config',
    ]) {
      assert.throws(() => resolveAuthorisedWrite(authority, hostile, 'create'), AuthorityRefused, hostile);
    }
    // The budget is a hard stop, not a hint.
    assert.throws(() => resolveAuthorisedWrite(authority, 'src/c.js', 'create'), /approval/);
    // Nothing escaped.
    assert.equal(existsSync(path.join(root, 'outside.js')), false);
  } finally { cleanup(); }
});

test('a write is verified by reading the bytes back', () => {
  const { root, sandbox, cleanup } = lab();
  try {
    const authority = grantProjectAuthority(path.join(root, 'New'), sandbox, 5, 5000);
    mkdirSync(authority.root, { recursive: true });
    const result = writeAuthorised(authority, 'src/a.js', 'const a = 1;\n');
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
    assert.equal(readFileSync(result.path, 'utf8'), 'const a = 1;\n');
    assert.throws(() => writeAuthorised(authority, 'src/b.js', ''), /no content/);
    assert.equal(authority.writesUsed, 1, 'a refused write must not consume budget');
  } finally { cleanup(); }
});

test('deletion, network, credentials and installs are never covered by project authority', () => {
  for (const operation of ['delete', 'network', 'credentials', 'outside_project', 'dependency_install']) {
    assert.equal(requiresSeparateApproval(operation), true, operation);
  }
});

// ----------------------------------------------------------- the plan

test('the plan states the destination, scope, files and commands, and creates nothing', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const bridge = offlineBridge(agent, sandbox);
    const result = await bridge.handle(REQUEST);
    const plan = agent.snapshot().plan;
    assert.equal(agent.snapshot().phase, 'awaiting_approval');
    assert.ok(plan.project);
    assert.equal(plan.project.root, path.join(root, 'AstrasBlog'));
    assert.ok(plan.project.manifest.length >= 5);
    assert.ok(plan.project.directories.includes('src'));
    assert.ok(plan.project.commands.some((c) => c.args.join(' ') === '--test'));

    // The chat reply must show Karl the whole scope and claim nothing.
    for (const expected of [/Absolute destination/, /What this approval permits/, /needs? separate approval/i, /Nothing has been created yet/i]) {
      assert.match(result.reply, expected);
    }
    assert.doesNotMatch(result.reply, /is now (?:running|available|live)/i);
    assert.equal(existsSync(path.join(root, 'AstrasBlog')), false);
    // An unapproved build cannot run.
    await assert.rejects(() => agent.runProjectBuild({ generate: false }), /not been approved/);
    assert.equal(existsSync(path.join(root, 'AstrasBlog')), false);
  } finally { cleanup(); }
});

test('the project scope is part of the approval fingerprint', async () => {
  const { sandbox, agent, cleanup } = lab();
  try {
    const bridge = offlineBridge(agent, sandbox);
    await bridge.handle(REQUEST);
    const before = scopeFingerprint(agent.snapshot().plan);
    agent.approve();
    // Widening the scope after approval must invalidate it, as for every other plan.
    const plan = agent.snapshot().plan;
    agent.plan = { ...plan, project: { ...plan.project, root: path.join(plan.project.root, 'elsewhere') } };
    await assert.rejects(() => agent.runProjectBuild({ generate: false }), /scope changed/i);
    assert.ok(before.length > 0);
  } finally { cleanup(); }
});

test('an occupied destination is refused rather than overwritten', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const target = path.join(root, 'AstrasBlog');
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'keep.txt'), 'keep me');
    const bridge = offlineBridge(agent, sandbox);
    const result = await bridge.handle(REQUEST);
    assert.match(result.reply, /not available/i);
    assert.equal(readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep me');
    assert.equal(agent.snapshot().phase, 'idle');
  } finally { cleanup(); }
});

// ---------------------------------------------------------- the build

test('one approval builds, writes, verifies and validates a working project', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const bridge = offlineBridge(agent, sandbox);
    await bridge.handle(REQUEST);
    agent.approve();
    await agent.runProjectBuild({ generate: false });
    const snapshot = agent.snapshot();
    const target = path.join(root, 'AstrasBlog');

    assert.equal(existsSync(path.join(target, '.git')), false);

    // Real application code, verified byte for byte.
    assert.ok(existsSync(path.join(target, 'src', 'server.js')));
    assert.ok(readFileSync(path.join(target, 'src', 'server.js'), 'utf8').includes("node:http"));

    // Validation actually ran and actually passed.
    assert.equal(snapshot.testResults.length, snapshot.plan.commands.length);
    assert.ok(snapshot.testResults.every((result) => result.ok), 'every approved command must pass');
    assert.equal(snapshot.buildReport.validated, true);
    assert.equal(snapshot.buildReport.files, snapshot.plan.project.manifest.length);
    assert.equal(snapshot.buildReport.launchCommand, 'node src/server.js');
    // Launch instructions, and no invented service.
    assert.match(readFileSync(path.join(target, 'README.md'), 'utf8'), /node src\/server\.js/);
    assert.doesNotMatch(JSON.stringify(snapshot.buildReport), /running|listening/i);
  } finally { cleanup(); }
});

test('a rejected project build creates nothing and can never be revived', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const bridge = offlineBridge(agent, sandbox);
    await bridge.handle(REQUEST);
    agent.reject('not now');
    assert.equal(agent.snapshot().phase, 'cancelled');
    await assert.rejects(() => agent.runProjectBuild({ generate: false }), /cancelled or rejected|not awaiting/);
    assert.equal(existsSync(path.join(root, 'AstrasBlog')), false);
  } finally { cleanup(); }
});

test('an unvalidated build is reported as unvalidated rather than as success', async () => {
  const { root, sandbox, agent, cleanup } = lab();
  try {
    const bridge = offlineBridge(agent, sandbox);
    await bridge.handle(REQUEST);
    agent.approve();
    // Replace the manifest with a file that cannot pass, to exercise the loop's
    // honest failure path without depending on the model being available.
    const plan = agent.snapshot().plan;
    agent.plan = {
      ...plan,
      project: { ...plan.project, baseline: { 'broken.js': 'function ( {' } },
      filesToChange: ['broken.js'],
      commands: [{ executable: 'node', args: ['--check', 'broken.js'], purpose: 'check' }],
    };
    agent.approvedFingerprint = scopeFingerprint(agent.plan);
    await agent.runProjectBuild({ generate: false });
    const report = agent.snapshot().buildReport;
    assert.equal(report.validated, false);
    assert.ok(report.issues.length > 0, 'a failure must be reported, not hidden');
    assert.ok(existsSync(path.join(root, 'AstrasBlog', 'broken.js')));
  } finally { cleanup(); }
});

test('the build is bounded and cannot be run twice under one approval', async () => {
  const { sandbox, agent, cleanup } = lab();
  try {
    const bridge = offlineBridge(agent, sandbox);
    await bridge.handle(REQUEST);
    agent.approve();
    const plan = agent.snapshot().plan;
    agent.plan = { ...plan, project: { ...plan.project, limits: { ...plan.project.limits, maxWrites: 2 } } };
    agent.approvedFingerprint = scopeFingerprint(agent.plan);
    // Only two writes are permitted, so the nine-file baseline cannot finish.
    await assert.rejects(() => agent.runProjectBuild({ generate: false }), /approval/);
  } finally { cleanup(); }
});

test('an existing repository is never taken over by project authority', () => {
  const { root, sandbox, cleanup } = lab();
  try {
    const existing = path.join(root, 'KarlProject');
    mkdirSync(path.join(existing, 'src'), { recursive: true });
    writeFileSync(path.join(existing, 'src', 'index.js'), 'module.exports = 1;\n');
    execFileSync('git', ['init', '-q', existing]);
    const target = path.join(root, 'AstrasBlog');
    mkdirSync(path.join(target, 'src'), { recursive: true });
    writeFileSync(path.join(target, 'src', 'index.js'), 'keep me');
    execFileSync('git', ['init', '-q', target]);
    // The grant refuses because the destination already exists.
    assert.throws(() => grantProjectAuthority(target, sandbox, 10, 5000), AuthorityRefused);
    assert.equal(readFileSync(path.join(target, 'src', 'index.js'), 'utf8'), 'keep me');
    assert.equal(readFileSync(path.join(existing, 'src', 'index.js'), 'utf8'), 'module.exports = 1;\n');
  } finally { cleanup(); }
});

test('a link cannot be used to write outside an approved project', () => {
  const { root, sandbox, cleanup } = lab();
  try {
    const outside = path.join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    const authority = grantProjectAuthority(path.join(root, 'Project'), sandbox, 5, 5000);
    mkdirSync(authority.root, { recursive: true });
    try {
      // A junction *inside* the granted project, pointing out of it.
      symlinkSync(outside, path.join(authority.root, 'link'), 'junction');
    } catch {
      return; // Creating links may be unavailable on this machine.
    }
    // pathGuard is the authoritative containment check and rejects the link first;
    // either refusal is a refusal.
    assert.throws(() => writeAuthorised(authority, 'link/escaped.js', 'x'), (error) => {
      assert.ok(error instanceof AuthorityRefused || error?.name === 'PathRejected', `unexpected refusal: ${error}`);
      return true;
    });
    assert.equal(existsSync(path.join(outside, 'escaped.js')), false);
  } finally { cleanup(); }
});

test('a project build never reaches the chat model as a coding patch', () => {
  // The whole point of routing: the request is a tool action, not a chat turn.
  const intent = routeCodingIntent(REQUEST);
  assert.equal(intent.kind, 'create_repository');
  assert.notEqual(intent.kind, 'chitchat');
});
