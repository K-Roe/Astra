/** Native acceptance of a direct file creation in Karl's requested directory. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = 'C:\\Users\\karlr\\repos\\astraBlog\\AstraBackstory.js';
const content = "export const AstraBackstory = {\n  name: 'Astra',\n  role: 'local companion',\n};\n";
const profile = mkdtempSync(path.join(os.tmpdir(), 'astra-direct-file-profile-'));
const output = path.join(root, 'test-results', 'direct-file');
mkdirSync(output, { recursive: true });
assert.equal(existsSync(target), false, 'Target already exists; acceptance must not overwrite it');
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
  await waitFor(page, `window.astra.getChatStatus().then(s=>s.messages.length>=${before + 2})`);
  const messages = JSON.parse(await evaluate(page, 'window.astra.getChatStatus().then(s=>JSON.stringify(s.messages))'));
  return messages.slice(before).filter((item) => item.role === 'assistant').at(-1)?.content ?? '';
}
async function screenshot(page, name) {
  const image = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'));
}

let child;
let browser;
let page;
let targetId;
try {
  const debuggingPort = await port();
  const env = { ...process.env, ASTRA_CA01_PROFILE: profile };
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

  const request = `Create the file ${target} with this exact content:\n\`\`\`js\n${content.trimEnd()}\n\`\`\``;
  const proposal = await send(page, request);
  const pending = JSON.parse(await waitFor(page, "window.astraIntelligence.codingSnapshot().then(s=>s.phase==='awaiting_approval'?JSON.stringify(s):null)"));
  assert.equal(pending.plan?.fileOperation?.target, target);
  assert.equal(pending.plan?.fileOperation?.content, content);
  assert.match(proposal, /Nothing has been changed/);
  assert.equal(existsSync(target), false, 'File must not exist before approval');
  assert.equal(existsSync(path.join(path.dirname(target), '.git')), false, 'No Git repository should be created');
  await waitFor(page, `document.querySelector('.coding-chat-control')?.dataset.taskId===${JSON.stringify(String(pending.taskId))}`);
  await screenshot(page, 'awaiting-approval.png');
  await evaluate(page, "document.querySelector('.coding-chat-control button').click(); true");
  const completed = JSON.parse(await waitFor(page, "window.astraIntelligence.codingSnapshot().then(s=>s.phase==='completed'?JSON.stringify(s):null)", 120000));
  assert.equal(completed.events.some((event) => event.kind === 'file.verified' && event.ok), true);
  assert.equal(existsSync(target), true);
  assert.equal(readFileSync(target, 'utf8'), content);
  assert.equal(existsSync(path.join(path.dirname(target), '.git')), false);
  const messages = JSON.parse(await evaluate(page, 'window.astra.getChatStatus().then(s=>JSON.stringify(s.messages))'));
  const completionReply = messages.filter((item) => item.role === 'assistant' && /Created and verified/.test(item.content)).at(-1)?.content ?? '';
  assert.match(completionReply, /Created and verified/);
  const readback = await send(page, `Read file ${target}`);
  assert(readback.includes(content.trimEnd()), 'Chat readback differs from the file on disk');
  await screenshot(page, 'verified-readback.png');
  writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify({ request, proposal, completionReply, readback, target, content, verified: true, noGit: true }, null, 2));
  console.log(`PASS: real Electron chat proposed, approved, created and read back ${target} (${Buffer.byteLength(content)} bytes); no Git repository created.`);
  console.log(`Chat completion: ${completionReply}`);
} finally {
  try { if (browser && targetId) await browser.send('Target.closeTarget', { targetId: targetId.id }); } catch { /* closed */ }
  if (child && child.exitCode === null) {
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(10000)]);
    if (child.exitCode === null) child.kill();
  }
  page?.close();
  browser?.close();
  rmSync(profile, { recursive: true, force: true });
}
