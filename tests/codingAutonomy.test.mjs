import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
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
const { analyseProjectRequest, buildProjectScaffold, validateGeneratedFiles } = require('../dist-electron/main/agent/projectBuild.js');
const { discoverRepositories } = require('../dist-electron/main/workspace/repoTools.js');
const { assertCommandAllowed } = require('../dist-electron/main/workspace/commandRunner.js');
const { routeCodingIntent } = require('../dist-electron/main/agent/codingIntent.js');
const { verifyReactApplication } = require('../dist-electron/main/agent/applicationVerification.js');

function lab() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'astra-autonomy-'));
  const root = path.join(base, 'repos');
  mkdirSync(root);
  const db = new AstraDatabase(path.join(base, 'astra.db'));
  db.migrate();
  const agent = new CodingAgent({ root }, new ApprovalManager(db), new TaskStore(db), new MemoryStore(db));
  return { root, agent, cleanup() { db.close(); rmSync(base, { recursive: true, force: true }); } };
}

test('React request creates real scoped application files without Git', async () => {
  const { root, agent, cleanup } = lab();
  try {
    const name = 'MyWebsite';
    const spoken = 'Create a React website called MyWebsite with a homepage, navigation and about page.';
    const request = analyseProjectRequest(spoken, name);
    const baseline = buildProjectScaffold(name, request.kind, request.stack);
    assert.equal(request.buildsApplication, true);
    assert.deepEqual(JSON.parse(baseline['package.json']).dependencies.react, '^19.3.0');
    const manifest = Object.keys(baseline);
    const destination = path.join(root, name);
    const bridge = new CodingBridge(agent, { root });
    const proposal = await bridge.handle(spoken);
    assert.equal(proposal.snapshot.plan.project.root, destination);
    assert.deepEqual(proposal.snapshot.plan.project.manifest, manifest);
    assert.equal(existsSync(destination), false);
    agent.approve();
    const result = await agent.runProjectBuild({ generate: false });
    assert.equal(result.buildReport.validated, false);
    assert.match(result.buildReport.issues.join(' '), /dependencies are unavailable/i);
    assert.equal(result.buildReport.fromModel, 0);
    assert.equal(existsSync(path.join(destination, '.git')), false);
    for (const file of ['package.json', 'tsconfig.json', 'index.html', 'src/main.tsx', 'src/App.tsx', 'src/components/Navigation.tsx', 'src/pages/HomePage.tsx', 'src/pages/AboutPage.tsx', 'src/styles.css']) {
      assert.equal(readFileSync(path.join(destination, file), 'utf8'), baseline[file]);
    }
    assert.match(readFileSync(path.join(destination, 'src/App.tsx'), 'utf8'), /<Navigation/);
  } finally { cleanup(); }
});

test('existing project patch preserves unrelated files and refuses stale approved bytes', async () => {
  const { root, agent, cleanup } = lab();
  try {
    const project = path.join(root, 'Existing');
    mkdirSync(path.join(project, 'src'), { recursive: true });
    writeFileSync(path.join(project, 'package.json'), '{"name":"existing"}\n');
    writeFileSync(path.join(project, 'src', 'App.jsx'), 'export default function App() { return <h1>Old</h1>; }\n');
    writeFileSync(path.join(project, 'src', 'notes.txt'), 'Karl work\n');
    assert.ok(discoverRepositories({ root }).some((entry) => entry.root === project));
    agent.selectRepository(project);
    const patches = [{ file: 'src/App.jsx', hunks: [{ find: '<h1>Old</h1>', replace: '<h1>New</h1>' }] }];
    await agent.beginTask({ objective: 'Update the homepage', repository: project, proposedFiles: ['src/App.jsx'], proposedPatches: patches });
    agent.approve();
    await agent.implement({ patches });
    await agent.review();
    assert.match(readFileSync(path.join(project, 'src', 'App.jsx'), 'utf8'), /<h1>New<\/h1>/);
    assert.equal(readFileSync(path.join(project, 'src', 'notes.txt'), 'utf8'), 'Karl work\n');
    assert.equal(existsSync(path.join(project, '.git')), false);
  } finally { cleanup(); }
});

test('command runner refuses Git execution', () => {
  assert.throws(() => assertCommandAllowed({ executable: 'git', args: ['init'], cwd: process.cwd(), purpose: 'test' }), /not in the allowlist/);
});

test('Laravel API work targets an existing backend and only permits bounded validation', async () => {
  const { root, agent, cleanup } = lab();
  try {
    const backend = path.join(root, 'backend');
    mkdirSync(path.join(backend, 'routes'), { recursive: true });
    writeFileSync(path.join(backend, 'composer.json'), '{"name":"demo/backend"}\n');
    writeFileSync(path.join(backend, 'artisan'), '<?php\n');
    writeFileSync(path.join(backend, 'routes/api.php'), "<?php\nRoute::get('/health', fn () => ['ok' => true]);\n");
    writeFileSync(path.join(backend, 'notes.txt'), 'Karl work\n');
    const spoken = 'Build a Laravel API in my backend folder';
    assert.equal(routeCodingIntent(spoken).kind, 'add_feature');
    assert.equal(routeCodingIntent(spoken).repositoryName, 'backend');
    const patches = [{ file: 'routes/api.php', hunks: [{ find: "['ok' => true]", replace: "['status' => 'ready']" }] }];
    const bridge = new CodingBridge(agent, { root }, async () => ({ rootCause: 'API response needs work', expectedOutcome: 'API returns its status', risks: [], patches }), () => false, () => ({ permitted: true, reason: '' }));
    const proposed = await bridge.handle(spoken);
    assert.equal(proposed.snapshot.phase, 'awaiting_approval');
    assert.equal(proposed.snapshot.plan.repository, backend);
    assert.deepEqual(proposed.snapshot.plan.commands, []);
    agent.approve();
    await agent.implement({ patches });
    await agent.review();
    assert.match(readFileSync(path.join(backend, 'routes/api.php'), 'utf8'), /status.*ready/);
    assert.equal(readFileSync(path.join(backend, 'notes.txt'), 'utf8'), 'Karl work\n');
    assert.equal(existsSync(path.join(backend, '.git')), false);
    assertCommandAllowed({ executable: 'php', args: ['artisan', 'test'], cwd: backend, purpose: 'test' });
    assert.throws(() => assertCommandAllowed({ executable: 'php', args: ['artisan', 'migrate'], cwd: backend, purpose: 'test' }), /limited/);
  } finally { cleanup(); }
});

test('React model output cannot add an undeclared package', () => {
  assert.throws(() => validateGeneratedFiles({ 'src/App.tsx': "import { BrowserRouter } from 'react-router-dom';\nexport default BrowserRouter;" }, ['src/App.tsx'], ['react', 'react-dom']), /undeclared package react-router-dom/);
  assert.throws(() => validateGeneratedFiles({ 'src/App.tsx': "import 'react-router-dom';\nexport default function App() { return null; }" }, ['src/App.tsx'], ['react', 'react-dom']), /undeclared package react-router-dom/);
});

test('partial astraBlog request retains its objective, plans missing files, and preserves existing work', async () => {
  const { root, agent, cleanup } = lab();
  try {
    const project = path.join(root, 'astraBlog');
    mkdirSync(project);
    const original = "export const AstraBackstory = { name: 'Astra', role: 'local companion' };\n";
    writeFileSync(path.join(project, 'AstraBackstory.js'), original);
    const spoken = `Build a complete React blog about Astra's new life at ${project}`;
    const baseline = buildProjectScaffold('astraBlog', 'blog', ['React']);
    const bridge = new CodingBridge(agent, { root }, undefined, undefined, undefined, undefined,
      async (_purpose, files) => Object.fromEntries(files.map((file) => [file, baseline[file]])));
    const proposal = await bridge.handle(spoken);
    assert.equal(proposal.snapshot.phase, 'awaiting_approval');
    assert.equal(proposal.snapshot.plan.application.root, project);
    assert.equal(proposal.snapshot.plan.workspaceScope.root, project);
    assert.equal(proposal.snapshot.plan.writes.length, 9);
    assert.equal(existsSync(path.join(project, 'package.json')), false);
    assert.equal((await bridge.handle('Continue')).snapshot.taskId, proposal.snapshot.taskId);
    assert.equal((await bridge.handle('Finish the website')).snapshot.taskId, proposal.snapshot.taskId);
    assert.equal((await bridge.handle('approve')).snapshot.approval.approved, false);
    assert.equal(readFileSync(path.join(project, 'AstraBackstory.js'), 'utf8'), original);
    agent.approve();
    await agent.implement({ patches: [], writes: proposal.snapshot.plan.writes });
    await agent.review();
    assert.equal(JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8')).scripts.dev, 'vite');
    assert.equal(readFileSync(path.join(project, 'AstraBackstory.js'), 'utf8'), original);
    assert.equal(existsSync(path.join(project, '.git')), false);
    const gate = verifyReactApplication(project, proposal.snapshot.plan.application.manifest);
    assert.equal(gate.dependenciesAvailable, false);
    assert.equal(gate.issues.length, 1);
    assert.match(gate.issues[0], /dependencies are unavailable/);
  } finally { cleanup(); }
});

test('an interrupted project is replanned as an existing workspace without reusing old approval', async () => {
  const { root, agent, cleanup } = lab();
  try {
    const project = path.join(root, 'MyWebsite');
    const baseline = buildProjectScaffold('MyWebsite', 'website', ['React']);
    const bridge = new CodingBridge(agent, { root }, undefined, undefined, undefined, undefined,
      async (_purpose, files) => Object.fromEntries(files.map((file) => [file, baseline[file]])));
    const first = await bridge.handle('Create a React website called MyWebsite');
    assert.equal(first.snapshot.plan.project.root, project);
    agent.approve();
    mkdirSync(project);
    writeFileSync(path.join(project, 'AstraBackstory.js'), 'Keep this work\n');
    await agent.pauseForShutdown();
    const resumed = await bridge.handle('Continue');
    assert.notEqual(resumed.snapshot.taskId, first.snapshot.taskId);
    assert.equal(resumed.snapshot.phase, 'awaiting_approval');
    assert.equal(resumed.snapshot.approval.approved, false);
    assert.equal(resumed.snapshot.plan.workspaceScope.root, project);
    assert.equal(resumed.snapshot.plan.application.root, project);
    assert.equal(existsSync(path.join(project, 'package.json')), false);
    assert.equal(readFileSync(path.join(project, 'AstraBackstory.js'), 'utf8'), 'Keep this work\n');
  } finally { cleanup(); }
});

test('a failed model proposal retains the partial-project objective for Continue', async () => {
  const { root, agent, cleanup } = lab();
  try {
    const project = path.join(root, 'astraBlog');
    mkdirSync(project);
    let attempts = 0;
    const baseline = buildProjectScaffold('astraBlog', 'blog', ['React']);
    const bridge = new CodingBridge(agent, { root }, undefined, undefined, undefined, undefined,
      async (_purpose, files) => {
        attempts += 1;
        if (attempts === 1) throw new Error('model unavailable');
        return Object.fromEntries(files.map((file) => [file, baseline[file]]));
      });
    const first = await bridge.handle(`Build a complete React blog at ${project}`);
    assert.equal(first.snapshot.phase, 'failed');
    assert.equal(first.snapshot.plan.application.root, project);
    assert.equal(existsSync(path.join(project, 'package.json')), false);
    const retry = await bridge.handle('Continue');
    assert.equal(attempts, 2);
    assert.equal(retry.snapshot.phase, 'awaiting_approval');
    assert.notEqual(retry.snapshot.taskId, first.snapshot.taskId);
    assert.equal(retry.snapshot.approval.approved, false);
  } finally { cleanup(); }
});

test('conversation proposes and applies an exact new React component in an existing project', async () => {
  const { root, agent, cleanup } = lab();
  try {
    const project = path.join(root, 'Existing');
    mkdirSync(path.join(project, 'src'), { recursive: true });
    writeFileSync(path.join(project, 'package.json'), '{"name":"existing","dependencies":{"react":"^19"}}\n');
    writeFileSync(path.join(project, 'src', 'App.tsx'), 'export default function App() { return <main>Keep</main>; }\n');
    const content = 'export default function Navigation() { return <nav aria-label="Main">Home</nav>; }\n';
    const bridge = new CodingBridge(agent, { root }, async () => { throw new Error('patch model must not run for a standalone component'); }, () => false, () => ({ permitted: true, reason: '' }), async () => content);
    const proposed = await bridge.handle('Create a navigation component in Existing');
    assert.equal(proposed.snapshot.phase, 'awaiting_approval');
    assert.deepEqual(proposed.snapshot.plan.workspaceScope.operations, ['create']);
    assert.equal(proposed.snapshot.plan.workspaceScope.maxWrites, 1);
    assert.deepEqual(proposed.snapshot.plan.writes, [{ file: 'src/components/Navigation.tsx', content }]);
    assert.equal(existsSync(path.join(project, 'src/components/Navigation.tsx')), false);
    agent.approve();
    await agent.implement({ patches: [], writes: proposed.snapshot.plan.writes });
    await agent.review();
    assert.equal(readFileSync(path.join(project, 'src/components/Navigation.tsx'), 'utf8'), content);
    assert.match(readFileSync(path.join(project, 'src/App.tsx'), 'utf8'), /Keep/);
    assert.equal(existsSync(path.join(project, '.git')), false);
  } finally { cleanup(); }
});

test('a new page and its existing app integration share one approved scope', async () => {
  const { root, agent, cleanup } = lab();
  try {
    const project = path.join(root, 'Existing');
    mkdirSync(path.join(project, 'src'), { recursive: true });
    writeFileSync(path.join(project, 'package.json'), '{"name":"existing","dependencies":{"react":"^19"}}\n');
    writeFileSync(path.join(project, 'src', 'App.tsx'), 'export default function App() { return <main>Home</main>; }\n');
    const page = 'export default function LoginPage() { return <form><label>Email<input type="email" /></label></form>; }\n';
    const patches = [{ file: 'src/App.tsx', hunks: [{ find: '<main>Home</main>', replace: '<main><a href="/login">Login</a>Home</main>' }] }];
    const bridge = new CodingBridge(agent, { root }, async () => ({ rootCause: 'No login page', expectedOutcome: 'Login page is available', risks: [], patches }), () => false, () => ({ permitted: true, reason: '' }), async () => page);
    const proposed = await bridge.handle('Add a login page to Existing');
    assert.equal(proposed.snapshot.phase, 'awaiting_approval');
    assert.deepEqual(proposed.snapshot.plan.workspaceScope.operations, ['patch', 'create']);
    assert.equal(proposed.snapshot.plan.workspaceScope.maxWrites, 2);
    assert.deepEqual(proposed.snapshot.plan.writes, [{ file: 'src/pages/LoginPage.tsx', content: page }]);
    assert.deepEqual(proposed.snapshot.plan.patches, patches);
    agent.approve();
    await agent.implement({ patches, writes: proposed.snapshot.plan.writes });
    await agent.review();
    assert.equal(readFileSync(path.join(project, 'src/pages/LoginPage.tsx'), 'utf8'), page);
    assert.match(readFileSync(path.join(project, 'src/App.tsx'), 'utf8'), /Login/);
  } finally { cleanup(); }
});
