/** Native chat acceptance for conversational repository creation. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isolated = mkdtempSync(path.join(os.tmpdir(), 'astra-conversation-'));
const profile = path.join(isolated, 'profile');
const repositories = path.join(isolated, 'repos');
const output = path.join(appRoot, 'test-results', 'conversational-repository');
mkdirSync(profile, { recursive: true });
mkdirSync(repositories, { recursive: true });
mkdirSync(output, { recursive: true });
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  assert(ok, name);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function jsonAt(url) {
  for (let i = 0; i < 120; i++) {
    try { const result = await fetch(url); if (result.ok) return result.json(); } catch { /* starting */ }
    await delay(200);
  }
  throw new Error(`Electron debugging endpoint timed out: ${url}`);
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
    ready: new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    }),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}
async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Renderer evaluation failed');
  return result.result.value;
}
async function waitFor(page, expression, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await evaluate(page, expression);
    if (value) return value;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
async function screenshot(page, name) {
  const result = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(output, name), Buffer.from(result.data, 'base64'));
}
async function sendThroughComposer(page, message) {
  const before = await evaluate(page, 'window.astra.getChatStatus().then(s=>s.messages.length)');
  await evaluate(page, `(()=>{const input=document.querySelector('#message-input');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,${JSON.stringify(message)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await waitFor(page, "!document.querySelector('.send-button').disabled", 5000);
  await evaluate(page, "document.querySelector('.send-button').click(); true");
  await waitFor(page, `window.astra.getChatStatus().then(s=>s.messages.length>=${before + 2})`);
  const messages = JSON.parse(await evaluate(page, 'window.astra.getChatStatus().then(s=>JSON.stringify(s.messages))'));
  return messages.slice(before).filter((item) => item.role === 'assistant').at(-1)?.content ?? '';
}
const destination = path.join(repositories, 'AstraStone');
let child;
let browser;
let page;
let target;
try {
  const port = await freePort();
  const env = { ...process.env, ASTRA_CA01_PROFILE: profile, ASTRA_ACCEPTANCE_REPOSITORY_ROOT: repositories };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, ['.', '--ca01-acceptance', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', `--remote-debugging-port=${port}`], { cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {});
  target = (await jsonAt(`http://127.0.0.1:${port}/json/list`)).find((item) => item.type === 'page' && item.title === 'ASTRA');
  if (!target) {
    for (let i = 0; i < 100 && !target; i++) {
      await delay(200);
      target = (await jsonAt(`http://127.0.0.1:${port}/json/list`)).find((item) => item.type === 'page' && item.title === 'ASTRA');
    }
  }
  assert(target, 'Astra window did not render');
  const version = await jsonAt(`http://127.0.0.1:${port}/json/version`);
  browser = connect(version.webSocketDebuggerUrl);
  page = connect(target.webSocketDebuggerUrl);
  await Promise.all([browser.ready, page.ready]);
  await waitFor(page, "document.querySelector('.world-viewport')?.dataset.characterAsset === 'ready' && document.querySelector('.status')?.innerText !== 'Checking the local model.'");
  const model = await evaluate(page, "document.querySelector('.status')?.innerText ?? ''");
  record('real chat service is ready', !/offline|unavailable|checking/i.test(model), model);
  const gemma = await sendThroughComposer(page, 'Hello Astra, please say hello.');
  record('real Gemma conversation responds before the coding request', gemma.length > 0 && !/offline|unavailable|could not connect/i.test(gemma), gemma);

  const reply = await sendThroughComposer(page, 'Create a new Git repository called AstraStone.');
  const snapshot = JSON.parse(await waitFor(page, "window.astraIntelligence.codingSnapshot().then(s=>s.phase==='awaiting_approval'?JSON.stringify(s):null)"));
  record('exact request creates a real approval plan', snapshot.plan?.newRepository?.name === 'AstraStone' && snapshot.plan?.repository === destination, reply);
  record('chat shows destination and initial structure', reply.includes(destination) && /package\.json|README\.md/.test(reply) && !/cannot actually create/i.test(reply));
  record('nothing exists before approval', !existsSync(destination));
  await waitFor(page, `document.querySelector('.coding-chat-control')?.dataset.taskId===${JSON.stringify(String(snapshot.taskId))}`);
  await waitFor(page, "(()=>{const v=document.querySelector('.world-viewport');return v?.dataset.activity==='awaiting_approval' && v.astraDiagnostics?.state==='seated'})()", 25000);
  await screenshot(page, '01-awaiting-approval.png');
  const waiting = await evaluate(page, "JSON.stringify({activity:document.querySelector('.world-viewport')?.dataset.activity,state:document.querySelector('.world-viewport')?.astraDiagnostics?.state,clip:document.querySelector('.world-viewport')?.astraDiagnostics?.clip})");
  record('approval is seated without active typing', !/desk_work/.test(waiting) && /seated_idle/.test(waiting), waiting);
  await evaluate(page, "document.querySelector('.coding-chat-control button').click(); true");
  const done = JSON.parse(await waitFor(page, "window.astraIntelligence.codingSnapshot().then(s=>s.phase==='completed'?JSON.stringify(s):null)", 120000));
  await screenshot(page, '02-created.png');
  record('approved work completes', done.phase === 'completed');
  const gitRoot = execFileSync('git', ['-C', destination, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  record('filesystem and Git contain the created project', existsSync(path.join(destination, 'package.json')) && existsSync(path.join(destination, 'README.md')) && path.resolve(gitRoot).toLowerCase() === path.resolve(destination).toLowerCase(), JSON.stringify({ gitRoot, destination, files: Object.keys(done.plan?.newRepository?.files ?? {}) }));
  const chatAfter = JSON.parse(await evaluate(page, 'window.astra.getChatStatus().then(s=>JSON.stringify(s.messages))'));
  const completionReply = chatAfter.filter((item) => item.role === 'assistant' && item.content.includes(destination) && /created|complete/i.test(item.content)).at(-1)?.content ?? '';
  record('chat reports a verified result', Boolean(completionReply), completionReply);

  const occupied = await sendThroughComposer(page, 'Create a new Git repository called AstraStone.');
  record('occupied destination is refused', /NOT AVAILABLE|already exists/i.test(occupied) && !/approve to create it/i.test(occupied));
  const rejectedName = 'AstraStoneRejected';
  const rejectedPath = path.join(repositories, rejectedName);
  const rejected = await sendThroughComposer(page, `Create a new Git repository called ${rejectedName}.`);
  record('second plan reaches approval', rejected.includes(rejectedPath));
  await waitFor(page, "document.querySelector('.coding-chat-control button:last-child')?.innerText==='Reject'");
  await screenshot(page, '03-reject-plan.png');
  await evaluate(page, "document.querySelector('.coding-chat-control button:last-child').click(); true");
  const rejectedState = JSON.parse(await waitFor(page, "window.astraIntelligence.codingSnapshot().then(s=>['rejected','cancelled','idle','failed'].includes(s.phase)?JSON.stringify(s):null)", 10000));
  record('rejected project is absent', !existsSync(rejectedPath) && rejectedState.phase !== 'completed', rejectedState.phase);
  writeFileSync(path.join(output, 'results.json'), JSON.stringify({ model, gemma, root: repositories, reply, completionReply, occupied, rejected, results }, null, 2));
} finally {
  try { if (browser && target) await browser.send('Target.closeTarget', { targetId: target.id }); } catch { /* already closed */ }
  if (child && child.exitCode === null) {
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(10000)]);
    if (child.exitCode === null) child.kill();
  }
  page?.close();
  browser?.close();
  rmSync(isolated, { recursive: true, force: true });
}
