/** Native CA-01B acceptance. Karl makes every decision in the visible app. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const disposable = mkdtempSync(path.join(os.tmpdir(), 'astra-ca01b-'));
const repositories = path.join(disposable, 'repos');
mkdirSync(repositories);
const target = path.join(repositories, 'astraBlog', 'AstraBackstory.js');
const profile = path.join(disposable, 'profile');
mkdirSync(profile);
const output = path.join(root, 'test-results', 'ca01b');
mkdirSync(output, { recursive: true });
assert.equal(existsSync(target), false);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const result = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return result;
}
async function jsonAt(url) {
  for (let i = 0; i < 120; i++) {
    try { const result = await fetch(url); if (result.ok) return result.json(); } catch { /* starting */ }
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'renderer evaluation failed');
  return result.result.value;
}
async function waitFor(page, expression, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await evaluate(page, expression);
    if (value) return value;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
async function send(page, message) {
  const before = await evaluate(page, 'window.astra.getChatStatus().then(s=>s.messages.length)');
  await evaluate(page, `(()=>{const input=document.querySelector('#message-input');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,${JSON.stringify(message)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await waitFor(page, "!document.querySelector('.send-button').disabled", 5000);
  await evaluate(page, "document.querySelector('.send-button').click(); true");
  await waitFor(page, `window.astra.getChatStatus().then(s=>s.messages.length>=${before + 2})`, 150000);
  const messages = JSON.parse(await evaluate(page, 'window.astra.getChatStatus().then(s=>JSON.stringify(s.messages))'));
  return messages.slice(before).filter((item) => item.role === 'assistant').at(-1)?.content ?? '';
}
async function screenshot(page, name) {
  const image = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'));
}
async function operatorContinue(label) {
  console.log(`PAUSED FOR REVIEW: ${label}. Send a newline to this harness to continue.`);
  await new Promise((resolve) => { process.stdin.resume(); process.stdin.once('data', resolve); });
}
async function decision(page, expected) {
  const state = await waitFor(page, `window.astraIntelligence.codingSnapshot().then(s=>['completed','cancelled','failed'].includes(s.phase)?JSON.stringify(s):null)`, 600000);
  const snapshot = JSON.parse(state);
  assert.equal(snapshot.phase, expected, `Karl's UI decision resulted in ${snapshot.phase}; expected ${expected}`);
  return snapshot;
}

let child;
let browser;
let page;
let targetId;
try {
  const debuggingPort = await port();
  const env = { ...process.env, ASTRA_CA01_PROFILE: profile, ASTRA_ACCEPTANCE_REPOSITORY_ROOT: repositories };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, ['.', '--ca01-acceptance', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', `--remote-debugging-port=${debuggingPort}`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {});
  const targetsUrl = `http://127.0.0.1:${debuggingPort}/json/list`;
  for (let i = 0; i < 120 && !targetId; i++) {
    const found = (await jsonAt(targetsUrl)).find((item) => item.type === 'page' && item.title === 'ASTRA');
    if (found) targetId = found;
    else await delay(200);
  }
  assert(targetId, 'Astra window did not render');
  const version = await jsonAt(`http://127.0.0.1:${debuggingPort}/json/version`);
  browser = connect(version.webSocketDebuggerUrl);
  page = connect(targetId.webSocketDebuggerUrl);
  await Promise.all([browser.ready, page.ready]);
  await waitFor(page, "document.querySelector('.world-viewport')?.dataset.characterAsset==='ready' && document.querySelector('.status')?.innerText==='Ready'");

  const request = 'Astra, create a JavaScript file in astraBlog called AstraBackstory.js containing an exported object describing your personality, background and purpose.';
  const proposal = await send(page, request);
  const pending = JSON.parse(await waitFor(page, "window.astraIntelligence.codingSnapshot().then(s=>s.phase==='awaiting_approval'?JSON.stringify(s):null)"));
  assert.equal(pending.plan?.fileOperation?.target, target);
  const content = pending.plan?.fileOperation?.content;
  assert.match(content, /export/);
  assert.match(proposal, /Nothing has been changed/);
  assert.equal(existsSync(target), false);
  await screenshot(page, 'generated-create-pending.png');
  console.log(`WAITING FOR KARL: approve generated create in the visible Astra window. Target: ${target}`);
  const completed = await decision(page, 'completed');
  assert.equal(completed.events.some((event) => event.kind === 'file.verified' && event.ok), true);
  assert.equal(existsSync(target), true);
  assert.equal(readFileSync(target, 'utf8'), content);
  assert.equal(existsSync(path.join(path.dirname(target), '.git')), false);
  const messages = JSON.parse(await evaluate(page, 'window.astra.getChatStatus().then(s=>JSON.stringify(s.messages))'));
  const completionReply = messages.filter((item) => item.role === 'assistant' && /Created and verified/.test(item.content)).at(-1)?.content ?? '';
  assert.match(completionReply, /Created and verified/);
  const readback = await send(page, `Read file ${target}`);
  assert(readback.includes(content.trimEnd()), 'Chat readback differs from the file on disk');
  await screenshot(page, 'generated-create-verified.png');
  await operatorContinue('generated create verified; inspect evidence before the edit request');

  const editRequest = `Replace the contents of this file ${target} with a cleaner exported JavaScript object that preserves the personality, background and purpose and adds a capabilities array containing coding, learning and user-approved personal memory.`;
  const editProposal = await send(page, editRequest);
  const editPending = JSON.parse(await waitFor(page, "window.astraIntelligence.codingSnapshot().then(s=>s.phase==='awaiting_approval'?JSON.stringify(s):null)"));
  const editedContent = editPending.plan?.fileOperation?.content;
  assert.equal(editPending.plan?.fileOperation?.action, 'edit');
  assert.equal(readFileSync(target, 'utf8'), content);
  await screenshot(page, 'generated-edit-pending.png');
  console.log(`WAITING FOR KARL: approve generated edit in the visible Astra window. Target: ${target}`);
  await decision(page, 'completed');
  assert.equal(readFileSync(target, 'utf8'), editedContent);
  await screenshot(page, 'generated-edit-verified.png');
  await operatorContinue('generated edit verified; inspect evidence before the first delete request');

  const deleteRequest = `Delete file ${target}`;
  const firstDeleteProposal = await send(page, deleteRequest);
  const firstDelete = JSON.parse(await waitFor(page, "window.astraIntelligence.codingSnapshot().then(s=>s.phase==='awaiting_approval'?JSON.stringify(s):null)"));
  assert.equal(firstDelete.plan?.fileOperation?.target, target);
  await screenshot(page, 'delete-first-pending.png');
  console.log('WAITING FOR KARL: REJECT the first deletion in the visible Astra window.');
  await decision(page, 'cancelled');
  assert.equal(readFileSync(target, 'utf8'), editedContent);
  await operatorContinue('first deletion rejected; inspect unchanged file before stale deletion');

  await send(page, deleteRequest);
  await waitFor(page, "window.astraIntelligence.codingSnapshot().then(s=>s.phase==='awaiting_approval')");
  const externalContent = `${editedContent}\n// changed after planning by acceptance harness\n`;
  writeFileSync(target, externalContent);
  console.log('WAITING FOR KARL: approve the second deletion. It must fail because the disposable file changed after planning.');
  const stale = await decision(page, 'failed');
  assert.match(stale.error ?? '', /changed since planning/);
  assert.equal(readFileSync(target, 'utf8'), externalContent);
  await operatorContinue('stale deletion failed; inspect changed file before final deletion');

  const finalDeleteProposal = await send(page, deleteRequest);
  const finalPending = JSON.parse(await waitFor(page, "window.astraIntelligence.codingSnapshot().then(s=>s.phase==='awaiting_approval'?JSON.stringify(s):null)"));
  assert.equal(finalPending.plan?.fileOperation?.target, target);
  console.log('WAITING FOR KARL: approve the final deletion in the visible Astra window.');
  const finalCompleted = await decision(page, 'completed');
  assert.equal(existsSync(target), false);
  await screenshot(page, 'delete-verified.png');
  writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify({ request, proposal, completionReply, readback, editRequest, editProposal, firstDeleteProposal, finalDeleteProposal, target, generatedBytes: Buffer.byteLength(content), editedBytes: Buffer.byteLength(editedContent), staleError: stale.error, finalEvents: finalCompleted.events.map((event) => ({ kind: event.kind, ok: event.ok })), verified: true }, null, 2));
  console.log('PASS: real Electron chat generated, approved and verified create/edit; Karl rejected delete, stale delete failed safely, and Karl approved final delete.');
} finally {
  try { if (browser && targetId) await browser.send('Target.closeTarget', { targetId: targetId.id }); } catch { /* closed */ }
  if (child && child.exitCode === null) {
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(10000)]);
    if (child.exitCode === null) child.kill();
  }
  page?.close();
  browser?.close();
  if (path.resolve(disposable).startsWith(path.resolve(os.tmpdir()) + path.sep)) rmSync(disposable, { recursive: true, force: true });
}
