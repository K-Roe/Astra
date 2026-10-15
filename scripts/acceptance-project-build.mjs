/**
 * Native acceptance for a project Karl asks for in one sentence.
 *
 * Karl's exact request is sent through the real chat -> intent -> plan ->
 * approval -> build path, against a disposable TEMP repository root. The
 * approval decision is made by this harness because the approval is the thing
 * under test, not the human click; every other decision is Astra's own and is
 * checked against the disk afterwards.
 *
 * Nothing touches `C:\Users\karlr\repos`.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const disposable = mkdtempSync(path.join(os.tmpdir(), 'astra-project-acceptance-'));
const repositories = path.join(disposable, 'repos');
mkdirSync(repositories, { recursive: true });
const profile = path.join(disposable, 'profile');
mkdirSync(profile, { recursive: true });
const output = path.join(root, 'test-results', 'project-build');
mkdirSync(output, { recursive: true });

// A neighbouring project that must survive the build untouched.
const neighbour = path.join(repositories, 'KarlExistingProject');
mkdirSync(path.join(neighbour, 'src'), { recursive: true });
writeFileSync(path.join(neighbour, 'src', 'index.js'), 'module.exports = "untouched";\n');

const REQUEST = "Create a new repository called Astra's Blog and build me a working blog website.";
const destination = path.join(repositories, 'AstrasBlog');

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${String(detail).slice(0, 400)}` : ''}`);
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const result = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return result;
}
async function jsonAt(url) {
  for (let i = 0; i < 120; i += 1) {
    try { const result = await fetch(url); if (result.ok) return result.json(); } catch { /* still starting */ }
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
      id += 1;
      const messageId = id;
      socket.send(JSON.stringify({ id: messageId, method, params }));
      return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
    },
    close() { socket.close(); },
  };
}

let child;
let browser;
let page;
let completed = false;

try {
  const port = await freePort();
  const env = { ...process.env, ASTRA_CA01_PROFILE: profile, ASTRA_ACCEPTANCE_REPOSITORY_ROOT: repositories };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, ['.', '--ca01-acceptance', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', `--remote-debugging-port=${port}`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {});

  const findWindow = async () => (await jsonAt(`http://127.0.0.1:${port}/json/list`)).find((item) => item.type === 'page' && item.title === 'ASTRA');
  let target = await findWindow();
  for (let i = 0; i < 100 && !target; i += 1) {
    await delay(200);
    target = await findWindow();
  }
  assert(target, 'Astra window did not render');
  const version = await jsonAt(`http://127.0.0.1:${port}/json/version`);
  browser = connect(version.webSocketDebuggerUrl);
  page = connect(target.webSocketDebuggerUrl);
  await Promise.all([browser.ready, page.ready]);

  const evaluate = async (expression) => {
    const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
    return result.result.value;
  };
  const waitFor = async (expression, timeoutMs = 60000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await evaluate(`(() => { try { return ${expression}; } catch { return null; } })()`);
      if (value) return value;
      await delay(300);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };
  const send = async (text) => {
    const before = await evaluate("window.astra.getChatStatus().then(s=>s.messages.length)");
    await evaluate(`(()=>{const input=document.querySelector('#message-input');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await waitFor("!document.querySelector('.send-button').disabled", 10000);
    await evaluate("document.querySelector('.send-button').click(); true");
    await waitFor(`window.astra.getChatStatus().then(s=>s.messages.length>=${before + 2})`);
    const messages = JSON.parse(await evaluate("window.astra.getChatStatus().then(s=>JSON.stringify(s.messages))"));
    return messages.slice(before).filter((item) => item.role === 'assistant').at(-1)?.content ?? '';
  };

  await waitFor("document.querySelector('.world-viewport')?.dataset.characterAsset === 'ready'");

  // 1. One sentence in normal conversation.
  await send(REQUEST);
  const planned = JSON.parse(await waitFor("window.astraIntelligence.codingSnapshot().then(s=>s.plan&&s.plan.project?JSON.stringify(s):null)"));
  record('the request produces a project plan with no files or code from Karl', planned.plan.project.kind === 'blog', planned.plan.project.purpose);
  record('the plan names the folded destination', planned.plan.project.root === destination, planned.plan.project.root);
  record('the plan declares files, directories and commands', planned.plan.project.manifest.length > 0 && planned.plan.project.directories.length > 0 && planned.plan.commands.length > 0, `${planned.plan.project.manifest.length} files, ${planned.plan.commands.length} commands`);

  const chat = JSON.parse(await evaluate("window.astra.getChatStatus().then(s=>JSON.stringify(s.messages))"));
  const planReply = chat.filter((m) => m.role === 'assistant').at(-1)?.content ?? '';
  record('the plan tells Karl what the approval permits and reserves', /What this approval permits/i.test(planReply) && /separate approval/i.test(planReply));
  record('nothing is claimed to be running', !/is (?:now )?(?:running|available|live)/i.test(planReply), planReply.slice(0, 120));
  record('nothing exists before approval', !existsSync(destination));

  // 2. Neighbouring project must be untouched by anything.
  record('the neighbouring project is untouched', readFileSync(path.join(neighbour, 'src', 'index.js'), 'utf8') === 'module.exports = "untouched";\n');

  // 3. Approve once, then the build runs itself. The click is the harness
  //    making the one decision the plan exists to ask for.
  await evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^Approve plan$/.test(x.textContent.trim()));if(!b)return false;b.click();return true})()");
  const finished = JSON.parse(await waitFor("window.astraIntelligence.codingSnapshot().then(s=>(s.buildReport||s.error)?JSON.stringify(s):null)", 600000));

  record('the directory exists on disk', existsSync(destination) && statSync(destination).isDirectory(), destination);
  record('it is a real Git repository', existsSync(path.join(destination, '.git')));
  // Run git from the harness, not from the renderer: the page has no `require`.
  const remote = execFileSync('git', ['-C', destination, 'remote'], { encoding: 'utf8' }).trim();
  record('no remote was created and nothing was pushed', remote === '', `git remote = "${remote}"`);

  const expectedFiles = ['package.json', 'README.md', 'src/posts.js', 'src/render.js', 'src/server.js', 'public/index.html', 'public/style.css', 'test/posts.test.js'];
  record('the website files contain real application code', expectedFiles.every((file) => existsSync(path.join(destination, file))), expectedFiles.filter((f) => !existsSync(path.join(destination, f))).join(',') || 'all present');
  record('the server is real Node HTTP code', /require\(.node:http.\)/.test(readFileSync(path.join(destination, 'src', 'server.js'), 'utf8')));

  const report = finished.buildReport;
  record('Astra verified the result with real commands', Boolean(report) && report.validated === true, JSON.stringify(report));
  record('every approved validation command passed', (finished.testResults ?? []).length > 0 && finished.testResults.every((r) => r.ok), `${(finished.testResults ?? []).filter((r) => r.ok).length}/${(finished.testResults ?? []).length}`);
  record('the report gives launch instructions without claiming a running site', /launch/i.test(JSON.stringify(report)) && !/listening|running/i.test(JSON.stringify(report)), report?.launchCommand);

  // 4. It really is launchable: start it ourselves and ask Astra, never assume.
  const appPort = await freePort();
  const server = spawn(process.execPath, ['src/server.js'], { cwd: destination, env: { ...process.env, PORT: String(appPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});
  try {
    let body = '';
    for (let i = 0; i < 50; i += 1) {
      try { body = await (await fetch(`http://127.0.0.1:${appPort}/api/posts`)).text(); break; } catch { await delay(200); }
    }
    const posts = body ? JSON.parse(body) : null;
    record('the generated site serves its API when launched', Array.isArray(posts?.posts) && posts.posts.length > 0, `${posts?.posts?.length ?? 0} posts`);

    // Astra must report that truthfully only after checking, never before.
    await send(`Is the website running on localhost:${appPort}?`);
    const checked = JSON.parse(await evaluate("window.astra.getChatStatus().then(s=>JSON.stringify(s.messages))"));
    const checkReply = checked.filter((m) => m.role === 'assistant').at(-1)?.content ?? '';
    record('Astra verifies a live address only by connecting to it', /accepted a connection|Verified/i.test(checkReply), checkReply.slice(0, 160));
  } finally {
    server.kill();
  }

  record('the neighbouring project survived the whole build', readFileSync(path.join(neighbour, 'src', 'index.js'), 'utf8') === 'module.exports = "untouched";\n');
  record('nothing was created outside the approved root', !existsSync(path.join(repositories, 'Astras Blog')), 'no un-folded directory');

  const failed = results.filter((r) => !r.ok);
  writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify({ request: REQUEST, destination, report, results, failed: failed.length }, null, 2));
  if (failed.length > 0) throw new Error(`${failed.length} project build acceptance check(s) failed: ${failed.map((f) => f.name).join('; ')}`);
  console.log(`\n${results.length}/${results.length} project build acceptance checks passed`);
  completed = true;
} catch (error) {
  console.error(`Project build acceptance failed: ${error instanceof Error ? error.message : String(error)}`);
  writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), destination, disposable, results }, null, 2));
  throw error;
} finally {
  try { await page?.close(); } catch { /* closed */ }
  try { await browser?.close(); } catch { /* closed */ }
  if (child && child.exitCode === null) {
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(10000)]);
    if (child.exitCode === null) child.kill();
  }
  if (completed && path.resolve(disposable).startsWith(path.resolve(os.tmpdir()) + path.sep)) rmSync(disposable, { recursive: true, force: true });
  else console.log(`Disposable acceptance root kept for inspection: ${disposable}`);
}