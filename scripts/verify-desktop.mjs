import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(projectRoot, 'test-results');

async function reservePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch { /* Electron is still starting. */ }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForAstraTarget(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`);
    const target = targets.find((item) => item.type === 'page' && item.title === 'ASTRA');
    if (target) return target;
    await delay(150);
  }
  throw new Error('ASTRA renderer did not reach its titled page');
}

function connectCdp(url, onEvent = () => {}) {
  const socket = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method) onEvent(message);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return {
    ready,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

function getMainWindowHandle(pid) {
  const output = execFileSync('powershell.exe', [
    '-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).MainWindowHandle`,
  ], { encoding: 'utf8' }).trim();
  return Number(output);
}

function resizeWindow(handle, width, height) {
  const command = `$signature='[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);'; Add-Type -Name NativeWindow -Namespace AstraTest -MemberDefinition $signature; [AstraTest.NativeWindow]::MoveWindow([IntPtr]${handle}, 100, 100, ${width}, ${height}, $true)`;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim();
  assert.equal(output, 'True', `Could not resize native window to ${width}x${height}`);
}

async function waitForRenderer(page) {
  const deadline = Date.now() + 15000;
  let lastResult;
  while (Date.now() < deadline) {
    const result = await page.send('Runtime.evaluate', {
      expression: "Boolean(document.querySelector('.app-frame') && document.body.innerText.includes('Hi, Karl.'))",
      returnByValue: true,
    });
    lastResult = result;
    if (result.result?.value === true) return;
    await delay(150);
  }
  const diagnosis = await page.send('Runtime.evaluate', {
    expression: "JSON.stringify({title:document.title,body:document.body?.innerText,root:document.querySelector('#root')?.innerHTML,bridge:typeof window.astra,html:document.documentElement.outerHTML.slice(0,1200)})",
    returnByValue: true,
  });
  throw new Error(`ASTRA chat screen did not render: ${JSON.stringify({ lastResult, diagnosis })}`);
}

async function waitForReady(page) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await page.send('Runtime.evaluate', { expression: "document.querySelector('.status')?.innerText", returnByValue: true });
    if (result.result?.value === 'Ready') return;
    if (result.result?.value === 'Error') throw new Error('Astra started in error state');
    await delay(150);
  }
  throw new Error('Astra did not reach Ready state');
}

async function sendUiMessage(page, content) {
  const result = await page.send('Runtime.evaluate', {
    expression: `(() => { const input = document.querySelector('#message-input'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(content)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
    returnByValue: true,
  });
  assert.equal(result.result.value, true);
  await delay(100);
  await page.send('Runtime.evaluate', { expression: "document.querySelector('.composer').requestSubmit()" });
}

async function waitForAssistantCount(page, expected, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await page.send('Runtime.evaluate', {
      expression: "JSON.stringify({count:document.querySelectorAll('.message-assistant').length,phase:document.querySelector('.status')?.innerText,answers:Array.from(document.querySelectorAll('.message-assistant .message-content')).map(e=>e.innerText)})",
      returnByValue: true,
    });
    const observed = JSON.parse(result.result.value);
    if (observed.count === expected && observed.phase === 'Ready') return observed.answers;
    if (observed.phase === 'Error') throw new Error('Desktop conversation entered error state');
    await delay(250);
  }
  throw new Error(`Timed out waiting for assistant reply ${expected}`);
}

async function inspectLayout(page, compact) {
  const result = await page.send('Runtime.evaluate', {
    expression: "JSON.stringify({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,avatar:(()=>{const r=document.querySelector('.avatar-panel').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})(),chat:(()=>{const r=document.querySelector('.conversation-panel').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})(),composer:(()=>{const r=document.querySelector('.composer').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})(),placeholder:document.querySelector('.placeholder-label')?.innerText,voice:Array.from(document.querySelectorAll('.voice-reserved button')).map(b=>({text:b.innerText,disabled:b.disabled,bottom:b.getBoundingClientRect().bottom})),presentation:document.querySelector('.avatar-panel')?.dataset.presentationState})",
    returnByValue: true,
  });
  const layout = JSON.parse(result.result.value);
  assert(layout.documentWidth <= layout.width + 1, `Horizontal overflow: ${JSON.stringify(layout)}`);
  assert(layout.avatar.width > 100 && layout.avatar.height > 100, 'Avatar panel collapsed');
  assert(layout.chat.width > 250 && layout.chat.height > 200, 'Conversation panel collapsed');
  assert(layout.composer.y + layout.composer.height <= layout.height + 1, 'Composer is clipped');
  assert.match(layout.placeholder, /Temporary character placeholder/i);
  assert.deepEqual(layout.voice.map(({ text, disabled }) => ({ text, disabled })), [{ text: 'Mic unavailable', disabled: true }, { text: 'Audio unavailable', disabled: true }]);
  assert(layout.voice.every((button) => button.bottom <= layout.height + 1), 'Reserved voice controls are clipped');
  assert.equal(layout.presentation, 'idle');
  if (compact) assert(layout.chat.y > layout.avatar.y, 'Compact layout did not stack panels');
  else assert(layout.chat.x > layout.avatar.x, 'Desktop layout did not place panels side by side');
  return layout;
}

async function capture(page, filename) {
  const screenshot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await mkdir(evidenceDir, { recursive: true });
  const screenshotPath = path.join(evidenceDir, filename);
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  return screenshotPath;
}

async function waitForExit(child, timeoutMs = 10000) {
  if (child.exitCode !== null) return child.exitCode;
  return await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(timeoutMs).then(() => { throw new Error('Electron did not exit after the window closed'); }),
  ]);
}

async function main() {
  const port = await reservePort();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  let browser;
  let page;
  const rendererEvents = [];
  try {
    const target = await waitForAstraTarget(port);
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
    browser = connectCdp(version.webSocketDebuggerUrl);
    page = connectCdp(target.webSocketDebuggerUrl, (event) => {
      if (['Log.entryAdded', 'Runtime.exceptionThrown', 'Runtime.consoleAPICalled'].includes(event.method)) {
        rendererEvents.push(event);
      }
    });
    await Promise.all([browser.ready, page.ready]);
    await page.send('Log.enable');
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await waitForRenderer(page);
    await waitForReady(page);
    const result = await page.send('Runtime.evaluate', {
      expression: `(async () => JSON.stringify({
        title: document.title,
        body: document.body.innerText,
        protocol: location.protocol,
        bridge: typeof window.astra?.getAppInfo,
        info: await window.astra.getAppInfo(),
        nodeRequire: typeof window.require,
        nodeProcess: typeof window.process,
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,
        background: getComputedStyle(document.querySelector('.shell')).backgroundColor
      }))()`,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.equal(result.exceptionDetails, undefined, `Renderer evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
    assert.equal(typeof result.result.value, 'string', `Renderer did not return inspection data: ${JSON.stringify(result)}`);
    const observed = JSON.parse(result.result.value);
    assert.equal(observed.title, 'ASTRA');
    assert.match(observed.body, /Hi, Karl/);
    assert.match(observed.body, /NO SAVED MEMORY/i);
    assert.equal(observed.protocol, 'file:');
    assert.equal(observed.bridge, 'function');
    assert.equal(observed.info.name, 'ASTRA');
    assert.match(observed.info.version, /^\d+\.\d+\.\d+$/);
    assert.equal(observed.nodeRequire, 'undefined');
    assert.equal(observed.nodeProcess, 'undefined');
    assert.match(observed.csp, /connect-src 'none'/);
    await inspectLayout(page, false);

    await sendUiMessage(page, 'For this session, my test word is violet. Acknowledge it briefly.');
    const thinking = await page.send('Runtime.evaluate', { expression: "document.querySelector('.avatar-panel')?.dataset.presentationState", returnByValue: true });
    assert.equal(thinking.result.value, 'thinking', 'Avatar did not reflect active local generation');
    await waitForAssistantCount(page, 1);
    await sendUiMessage(page, 'What test word did I just tell you?');
    const answers = await waitForAssistantCount(page, 2);
    assert.match(answers[1], /violet/i, 'Second reply did not use current-session context');
    await sendUiMessage(page, 'Will you remember this test word after I close Astra?');
    const personalityAnswers = await waitForAssistantCount(page, 3);
    assert.match(personalityAnswers[2], /(?:no|cannot|can't|won't|not remember|do not)/i, 'Astra did not acknowledge lack of persistent memory');
    await page.send('Runtime.evaluate', { expression: "document.querySelector('.conversation').scrollTop = 0" });
    await delay(150);
    const jumpBefore = await page.send('Runtime.evaluate', { expression: "Boolean(document.querySelector('.jump-latest'))", returnByValue: true });
    assert.equal(jumpBefore.result.value, true, 'Jump-to-latest control did not appear after scrolling up');
    await sendUiMessage(page, 'Give me one short sentence about local-first software.');
    await waitForAssistantCount(page, 4);
    const scrollHold = await page.send('Runtime.evaluate', { expression: "JSON.stringify({top:document.querySelector('.conversation').scrollTop,jump:Boolean(document.querySelector('.jump-latest'))})", returnByValue: true });
    const held = JSON.parse(scrollHold.result.value);
    assert(held.top < 72 && held.jump, 'New reply moved transcript away from the older messages');
    await page.send('Runtime.evaluate', { expression: "document.querySelector('.jump-latest').click()" });
    await delay(100);
    const screenshotPath = await capture(page, 'astra-living-desktop.png');
    const handle = getMainWindowHandle(child.pid);
    assert(handle > 0, `No native Windows main window handle for PID ${child.pid}`);
    resizeWindow(handle, 700, 560);
    await delay(400);
    await inspectLayout(page, true);
    resizeWindow(handle, 640, 480);
    await delay(400);
    await inspectLayout(page, true);
    const jumpAfterResize = await page.send('Runtime.evaluate', { expression: "Boolean(document.querySelector('.jump-latest'))", returnByValue: true });
    assert.equal(jumpAfterResize.result.value, false, 'Follow-latest state was lost during resize');
    const compactScreenshotPath = await capture(page, 'astra-living-compact.png');
    const cleared = await page.send('Runtime.evaluate', {
      expression: "(async () => { document.querySelectorAll('button').forEach(button => { if (button.innerText === 'Clear conversation') button.click(); }); await new Promise(resolve => setTimeout(resolve, 500)); return JSON.stringify({messages:document.querySelectorAll('.message').length,bridgeMessages:(await window.astra.getChatStatus()).messages.length}); })()",
      awaitPromise: true,
      returnByValue: true,
    });
    assert.deepEqual(JSON.parse(cleared.result.value), { messages: 0, bridgeMessages: 0 });
    assert.equal(rendererEvents.filter((event) => event.method === 'Runtime.exceptionThrown' || (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')).length, 0, `Renderer errors: ${JSON.stringify(rendererEvents)}`);

    console.log(`PASS: native window PID ${child.pid}, handle ${handle}; local renderer, live four-turn chat, scroll behavior, reset, desktop/compact layout and restricted bridge verified`);
    console.log(`Screenshots: ${screenshotPath}; ${compactScreenshotPath}`);

    const closed = await browser.send('Target.closeTarget', { targetId: target.id });
    assert.equal(closed.success, true);
    const exitCode = await waitForExit(child);
    assert.equal(exitCode, 0, `Electron exit code ${exitCode}; stderr: ${stderr}`);
    console.log('PASS: closing the window exited Electron with code 0');
  } catch (error) {
    console.error(`Electron stderr: ${stderr}`);
    console.error(`Renderer events: ${JSON.stringify(rendererEvents)}`);
    throw error;
  } finally {
    page?.close();
    browser?.close();
    if (child.exitCode === null) child.kill();
  }
}

await main();
