import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

const disposable = mkdtempSync(path.join(os.tmpdir(), 'astra-react-acceptance-'));
const root = path.join(disposable, 'repos');
mkdirSync(root);
const db = new AstraDatabase(path.join(disposable, 'astra.db'));
db.migrate();
try {
  const agent = new CodingAgent({ root }, new ApprovalManager(db), new TaskStore(db), new MemoryStore(db));
  const bridge = new CodingBridge(agent, { root });
  const proposal = await bridge.handle('Create a React website called MyWebsite with a homepage, navigation and about page.');
  assert.equal(proposal.snapshot?.phase, 'awaiting_approval');
  agent.approve();
  const result = await agent.runProjectBuild({ generate: true });
  const target = path.join(root, 'MyWebsite');
  for (const file of ['package.json', 'tsconfig.json', 'index.html', 'src/main.tsx', 'src/App.tsx', 'src/components/Navigation.tsx', 'src/pages/HomePage.tsx', 'src/pages/AboutPage.tsx']) {
    assert.ok(readFileSync(path.join(target, file), 'utf8').length > 0, `${file} is missing or empty`);
  }
  assert.equal(existsSync(path.join(target, '.git')), false);
  assert.match(readFileSync(path.join(target, 'src/main.tsx'), 'utf8'), /react-dom\/client/);
  assert.match(readFileSync(path.join(target, 'src/App.tsx'), 'utf8'), /HomePage|home/i);
  assert.match(readFileSync(path.join(target, 'src/App.tsx'), 'utf8'), /AboutPage|about/i);
  assert.match(readFileSync(path.join(target, 'src/App.tsx'), 'utf8'), /Navigation/);
  assert.match(readFileSync(path.join(target, 'src/components/Navigation.tsx'), 'utf8'), /<nav|aria-label|Home/i);
  assert.match(readFileSync(path.join(target, 'src/pages/HomePage.tsx'), 'utf8'), /<h1|home/i);
  assert.match(readFileSync(path.join(target, 'src/pages/AboutPage.tsx'), 'utf8'), /<h1|about/i);
  const dependencies = path.resolve('node_modules');
  if (existsSync(dependencies)) {
    symlinkSync(dependencies, path.join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    assert.ok(existsSync(npmCli), 'the installed npm CLI is unavailable');
    const build = spawnSync(process.execPath, [npmCli, 'run', 'build'], { cwd: target, encoding: 'utf8', shell: false });
    assert.equal(build.status, 0, `React build failed:\n${build.stdout}\n${build.stderr}`);
  }
  console.log(JSON.stringify({ root: target, report: result.buildReport, gitMetadata: false, buildWithAvailableDependencies: existsSync(dependencies) }, null, 2));
} finally {
  db.close();
  rmSync(disposable, { recursive: true, force: true });
}
