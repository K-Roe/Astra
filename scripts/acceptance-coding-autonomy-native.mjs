import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const disposable = mkdtempSync(path.join(os.tmpdir(), 'astra-react-native-'));
const repositories = path.join(disposable, 'repos');
const profile = path.join(disposable, 'profile');
mkdirSync(repositories);
mkdirSync(profile);
const destination = path.join(repositories, 'MyWebsite');
const request = 'Create a React website called MyWebsite with a homepage, navigation and about page.';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function jsonAt(url) {
  for (let i = 0; i < 120; i += 1) {
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch { /* still starting */ }
    if (child && child.exitCode !== null) throw new Error(`Electron exited ${child.exitCode} before the debug endpoint opened`);
    await delay(200);
  }
  throw new Error(`Electron debugging timed out at ${url}`);
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  });
  return {
    ready: new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); }),
    send(method, params = {}) {
      const messageId = ++id;
      socket.send(JSON.stringify({ id: messageId, method, params }));
      return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
    },
    close() { socket.close(); },
  };
}

let child;
let browser;
let page;
let electronError = '';
try {
  const port = await freePort();
  const env = { ...process.env, ASTRA_CA01_PROFILE: profile, ASTRA_ACCEPTANCE_REPOSITORY_ROOT: repositories };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, ['.', '--ca01-acceptance', `--remote-debugging-port=${port}`], { cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (chunk) => { electronError = `${electronError}${chunk.toString()}`.slice(-3000); });
  child.stdout.on('data', (chunk) => { electronError = `${electronError}${chunk.toString()}`.slice(-3000); });
  let target;
  for (let i = 0; i < 100 && !target; i += 1) {
    target = (await jsonAt(`http://127.0.0.1:${port}/json/list`)).find((item) => item.type === 'page' && item.title === 'ASTRA');
    if (!target) await delay(200);
  }
  assert.ok(target, 'Astra window did not render');
  browser = connect((await jsonAt(`http://127.0.0.1:${port}/json/version`)).webSocketDebuggerUrl);
  page = connect(target.webSocketDebuggerUrl);
  await Promise.all([browser.ready, page.ready]);
  const evaluate = async (expression) => {
    const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'renderer evaluation failed');
    return result.result.value;
  };
  const waitFor = async (expression, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await evaluate(`(() => { try { return ${expression}; } catch { return null; } })()`);
      if (value) return value;
      await delay(300);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };
  const sendChat = async (message) => {
    const count = await evaluate('window.astra.getChatStatus().then(s => s.messages.length)');
    await evaluate(`(() => { const input = document.querySelector('#message-input'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(message)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await waitFor("!document.querySelector('.send-button').disabled", 10_000);
    await evaluate("document.querySelector('.send-button').click(); true");
    await waitFor(`window.astra.getChatStatus().then(s => s.messages.length >= ${count + 2})`, 180_000);
    return evaluate('window.astra.getChatStatus().then(s => s.messages.at(-1).content)');
  };
  await waitFor("Boolean(document.querySelector('#message-input'))");
  await sendChat(request);
  const proposal = JSON.parse(await waitFor('window.astraIntelligence.codingSnapshot().then(s => s.plan?.project ? JSON.stringify(s) : null)'));
  assert.equal(proposal.plan.project.root, destination);
  assert.ok(proposal.plan.project.stack.includes('React'));
  assert.equal(existsSync(destination), false);
  assert.equal(proposal.phase, 'awaiting_approval');
  const continuation = await sendChat('Continue');
  assert.match(continuation, /awaiting approval/i);
  assert.equal((await evaluate('window.astraIntelligence.codingSnapshot().then(s => s.taskId)')), proposal.taskId);
  await waitFor("[...document.querySelectorAll('button')].some(item => item.textContent.trim() === 'Approve plan')");
  console.log(`APPROVAL_REQUIRED: In the visible Astra window, review the React project plan for ${destination} and click Approve plan yourself. The harness will only observe the result.`);
  const finished = JSON.parse(await waitFor('window.astraIntelligence.codingSnapshot().then(s => s.buildReport ? JSON.stringify(s) : null)', 900_000));
  assert.ok(finished.events.some((event) => event.kind === 'approval.granted'), 'the visible application did not record approval');
  assert.ok(existsSync(destination) && statSync(destination).isDirectory());
  assert.equal(existsSync(path.join(destination, '.git')), false);
  for (const file of ['package.json', 'tsconfig.json', 'index.html', 'src/main.tsx', 'src/App.tsx', 'src/components/Navigation.tsx', 'src/pages/HomePage.tsx', 'src/pages/AboutPage.tsx']) {
    assert.ok(readFileSync(path.join(destination, file), 'utf8').length > 0, `${file} missing`);
  }
  assert.match(readFileSync(path.join(destination, 'src/App.tsx'), 'utf8'), /Navigation/);
  assert.equal(finished.buildReport.root, destination);
  assert.equal(finished.buildReport.files, 9);
  assert.ok(finished.buildReport.fromModel > 0, 'the local coding model contributed no files');
  assert.equal(finished.buildReport.validated, false);
  assert.match(finished.buildReport.issues.join(' '), /dependencies are unavailable/i);
  const finalReply = await sendChat('Finish the website');
  assert.match(finalReply, /incomplete|dependencies are unavailable/i);
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  assert.ok(existsSync(npmCli), 'the installed npm CLI is unavailable');
  symlinkSync(path.join(appRoot, 'node_modules'), path.join(destination, 'node_modules'), 'junction');
  const build = spawnSync(process.execPath, [npmCli, 'run', 'build'], { cwd: destination, encoding: 'utf8', shell: false });
  assert.equal(build.status, 0, `React build failed:\n${build.stdout}\n${build.stderr}`);
  console.log(JSON.stringify({ phase: finished.phase, approvalRecorded: finished.events.some((event) => event.kind === 'approval.granted'), report: finished.buildReport, gitMetadata: false, request, continuation, finalReply, externalBuildWithAvailableDependencies: 'passed', files: finished.buildReport.files }, null, 2));
} catch (error) {
  console.error(`Native acceptance failed: ${error instanceof Error ? error.message : String(error)}; Electron exit ${child?.exitCode ?? 'pending'}; ${electronError}`);
  throw error;
} finally {
  page?.close();
  browser?.close();
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(10_000)]);
  }
  if (path.resolve(disposable).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    try { rmSync(disposable, { recursive: true, force: true, maxRetries: 10, retryDelay: 1000 }); }
    catch (error) { console.error(`Disposable acceptance directory remains at ${disposable}: ${error instanceof Error ? error.message : String(error)}`); }
  }
}
