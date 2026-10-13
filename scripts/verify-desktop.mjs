import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(projectRoot, 'test-results');
let occlusionAllowed = false;
let visibilityMethod = 'native';

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

function showWindow(handle, command) {
  const script = `$signature='[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'; Add-Type -Name NativeVisibility -Namespace AstraTest -MemberDefinition $signature; [AstraTest.NativeVisibility]::ShowWindow([IntPtr]${handle}, ${command})`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
}

/** Windows only reports document.hidden=false for the focused window; try to give Astra foreground. */
function focusWindow(handle) {
  const script = `$signature='[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId); [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint detach, bool attachState); [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();'; Add-Type -Name NativeFocus -Namespace AstraTest -MemberDefinition $signature; $h=[IntPtr]${handle}; $current=[AstraTest.NativeFocus]::GetCurrentThreadId(); $foreground=[AstraTest.NativeFocus]::GetForegroundWindow(); $target=[AstraTest.NativeFocus]::GetWindowThreadProcessId($foreground,[IntPtr]::Zero); if ($foreground -ne [IntPtr]::Zero -and $target -ne 0) { [void][AstraTest.NativeFocus]::AttachThreadInput($current,$target,$true) }; [void][AstraTest.NativeFocus]::ShowWindow($h,9); [void][AstraTest.NativeFocus]::BringWindowToTop($h); $ok=[AstraTest.NativeFocus]::SetForegroundWindow($h); if ($foreground -ne [IntPtr]::Zero -and $target -ne 0) { [void][AstraTest.NativeFocus]::AttachThreadInput($current,$target,$false) }; $ok`;
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
}

async function worldSnapshot(page) {
  const result = await page.send('Runtime.evaluate', {
    expression: "JSON.stringify((()=>{const v=document.querySelector('.world-viewport');const c=v?.querySelector('canvas');const d=v?.astraDiagnostics;return {state:v?.dataset.worldState,frames:Number(v?.dataset.frameCount),fps:Number(v?.dataset.fps),canvasWidth:c?.width,canvasHeight:c?.height,hidden:document.hidden,chatPhase:document.querySelector('.status')?.innerText,placeholder:document.querySelector('.placeholder-label')?.innerText,characterAsset:v?.dataset.characterAsset,characterError:v?.dataset.characterError,characterState:d?.state,characterClip:d?.clip,characterX:d?.x,characterZ:d?.z,idleToggle:!!document.querySelector('.idle-toggle input')}})())",
    returnByValue: true,
  });
  return JSON.parse(result.result.value);
}

/**
 * Waits for the rigged GLB, then confirms she actually leaves the spot she
 * started on. A character that loads but never moves is not integrated.
 */
async function verifyCharacterMovement(page) {
  const deadline = Date.now() + 60000;
  const start = await characterProbe(page);
  assert.equal(start.asset, 'ready', `rigged character failed to load (${start.error ?? 'unknown'})`);
  let moved = false;
  while (Date.now() < deadline && !moved) {
    await delay(1000);
    const current = await characterProbe(page);
    if (current.x !== start.x || current.z !== start.z) moved = true;
  }
  assert.equal(moved, true, 'character never navigated away from its starting waypoint');
  return { start, moved };
}

async function characterProbe(page) {
  const result = await page.send('Runtime.evaluate', {
    expression: "(()=>{const v=document.querySelector('.world-viewport');const d=v?.astraDiagnostics;return JSON.stringify({asset:v?.dataset.characterAsset,error:v?.dataset.characterError,state:d?.state,clip:d?.clip,x:d?.x,z:d?.z})})()",
    returnByValue: true,
  });
  return JSON.parse(result.result.value);
}

function nativeWindowState(handle) {
  const script = `$signature='[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'; Add-Type -Name NativeState -Namespace AstraTest -MemberDefinition $signature; [pscustomobject]@{ visible=[AstraTest.NativeState]::IsWindowVisible([IntPtr]${handle}); iconic=[AstraTest.NativeState]::IsIconic([IntPtr]${handle}); foreground=[AstraTest.NativeState]::GetForegroundWindow().ToInt64() } | ConvertTo-Json -Compress`;
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }));
}

async function waitForWorldRunning(page, handle) {
  const deadline = Date.now() + 15000;
  let observed;
  while (Date.now() < deadline) {
    observed = await worldSnapshot(page);
    if (observed.state === 'running' && observed.canvasWidth > 100) return observed;
    if (observed.hidden) {
      focusWindow(handle);
      await delay(250);
      if (occlusionAllowed && visibilityMethod === 'native') {
        await page.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
        if ((await worldSnapshot(page)).hidden) {
          await page.send('Runtime.evaluate', { expression: "Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); true" });
          visibilityMethod = 'test-only document.hidden override with backgrounding disabled';
        } else {
          visibilityMethod = 'CDP active lifecycle with backgrounding disabled';
        }
      }
      continue;
    }
    await delay(250);
  }
  throw new Error(`3D scene did not become visible: ${JSON.stringify({ observed, native: nativeWindowState(handle) })}`);
}

function cpuSnapshot() {
  return os.cpus().reduce((sum, core) => {
    const times = core.times;
    sum.idle += times.idle;
    sum.total += times.user + times.nice + times.sys + times.idle + times.irq;
    return sum;
  }, { idle: 0, total: 0 });
}

function sampleResources(pid) {
  let gpu = null;
  try {
    const raw = execFileSync('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.free', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).trim().split(',');
    gpu = { utilizationPercent: Number(raw[0]), usedMiB: Number(raw[1]), freeMiB: Number(raw[2]), scope: 'whole NVIDIA GPU; includes Ollama and other applications' };
  } catch { /* NVIDIA telemetry may be unavailable. */ }
  let electron = null;
  try {
    const script = `$all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize; $ids=@(${pid}); do { $next=@($all | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId } | ForEach-Object ProcessId); $ids+= $next } while ($next.Count -gt 0); $procs=@(Get-Process -Id $ids -ErrorAction SilentlyContinue); [pscustomobject]@{ count=$procs.Count; workingSetMiB=[math]::Round((($procs | Measure-Object WorkingSet64 -Sum).Sum / 1MB),1); cpuSeconds=[math]::Round((($procs | Measure-Object CPU -Sum).Sum),2) } | ConvertTo-Json -Compress`;
    electron = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }));
  } catch { /* Process telemetry may be unavailable. */ }
  return { timestamp: new Date().toISOString(), systemFreeRamMiB: Math.round(os.freemem() / 1048576), gpu, electron };
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
    expression: "JSON.stringify({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,avatar:(()=>{const r=document.querySelector('.avatar-panel').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})(),chat:(()=>{const r=document.querySelector('.conversation-panel').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})(),composer:(()=>{const r=document.querySelector('.composer').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})(),placeholder:document.querySelector('.placeholder-label')?.innerText,idleToggle:!!document.querySelector('.idle-toggle input'),voice:Array.from(document.querySelectorAll('.voice-reserved button')).map(b=>({text:b.innerText,disabled:b.disabled,bottom:b.getBoundingClientRect().bottom})),presentation:document.querySelector('.avatar-panel')?.dataset.presentationState})",
    returnByValue: true,
  });
  const layout = JSON.parse(result.result.value);
  assert(layout.documentWidth <= layout.width + 1, `Horizontal overflow: ${JSON.stringify(layout)}`);
  assert(layout.avatar.width > 100 && layout.avatar.height > 100, 'Avatar panel collapsed');
  assert(layout.chat.width > 250 && layout.chat.height > 200, 'Conversation panel collapsed');
  assert(layout.composer.y + layout.composer.height <= layout.height + 1, 'Composer is clipped');
  assert.match(layout.placeholder, /Astra character V1 · rigged locally/i);
  assert.equal(layout.idleToggle, true, 'Idle activities control is missing');
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
  const allowOccluded = process.argv.includes('--allow-occluded');
  occlusionAllowed = allowOccluded;
  const launchArgs = ['.', `--remote-debugging-port=${port}`];
  if (allowOccluded) launchArgs.push('--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding');
  const child = spawn(electron, launchArgs, {
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
    const handle = getMainWindowHandle(child.pid);
    assert(handle > 0, `No native Windows main window handle for PID ${child.pid}`);
    showWindow(handle, 9); // Ensure a restored window before measuring visible frames.
    let world = await waitForWorldRunning(page, handle);
    assert(world.canvasWidth > 100 && world.canvasHeight > 100, '3D canvas has no drawable size');
    const initialFrames = world.frames;
    const idleCpuStart = cpuSnapshot();
    await delay(1400);
    const idleCpuEnd = cpuSnapshot();
    world = await worldSnapshot(page);
    assert(world.frames > initialFrames + 3, 'Idle scene did not render successive frames');
    assert(world.fps >= 20 && world.fps <= 34, `Idle frame rate missed the 30 fps cap: ${JSON.stringify(world)}`);
    assert.equal(world.characterAsset, 'ready', `Rigged character did not load: ${world.characterError ?? 'unknown'}`);
    const character = await verifyCharacterMovement(page);
    assert.equal(character.start.asset, 'ready', 'Character asset regressed to fallback mid-run');
    const idleMetrics = { world, resources: sampleResources(child.pid), systemCpuPercent: Math.round(100 * (1 - (idleCpuEnd.idle - idleCpuStart.idle) / (idleCpuEnd.total - idleCpuStart.total))) };
    await page.send('Runtime.evaluate', { expression: "document.querySelector('.world-pause').click()" });
    await delay(200);
    const paused = await worldSnapshot(page);
    assert.equal(paused.state, 'manual');
    await delay(450);
    assert.equal((await worldSnapshot(page)).frames, paused.frames, 'Manual pause continued rendering');
    await page.send('Runtime.evaluate', { expression: "document.querySelector('.world-pause').click()" });
    await delay(250);
    assert((await worldSnapshot(page)).frames > paused.frames, 'Scene did not resume');
    showWindow(handle, 6); // SW_MINIMIZE
    await delay(500);
    const minimized = await worldSnapshot(page);
    assert.equal(minimized.state, 'hidden', `Minimized scene was not hidden: ${JSON.stringify(minimized)}`);
    await delay(400);
    assert.equal((await worldSnapshot(page)).frames, minimized.frames, 'Minimized scene continued rendering');
    showWindow(handle, 9); // SW_RESTORE
    await delay(400);
    assert.equal((await worldSnapshot(page)).state, 'running', 'Restored scene did not resume');

    const firstReplyStart = performance.now();
    await sendUiMessage(page, 'For this session, my test word is violet. Acknowledge it, then give four concise sentences about local-first software and honest memory boundaries.');
    const thinking = await page.send('Runtime.evaluate', { expression: "document.querySelector('.avatar-panel')?.dataset.presentationState", returnByValue: true });
    assert.equal(thinking.result.value, 'thinking', 'Avatar did not reflect active local generation');
    const generatingStartFrames = (await worldSnapshot(page)).frames;
    const generatingCpuStart = cpuSnapshot();
    await delay(1200);
    const generatingCpuEnd = cpuSnapshot();
    const generatingWorld = await worldSnapshot(page);
    assert(generatingWorld.frames > generatingStartFrames, '3D scene stopped responding while Gemma generated');
    const generatingMetrics = { world: generatingWorld, resources: sampleResources(child.pid), systemCpuPercent: Math.round(100 * (1 - (generatingCpuEnd.idle - generatingCpuStart.idle) / (generatingCpuEnd.total - generatingCpuStart.total))), elapsedMs: 1200 };
    await waitForAssistantCount(page, 1);
    const firstReplyLatencyMs = Math.round(performance.now() - firstReplyStart);
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
    const screenshotPath = await capture(page, 'astra-lw01-desktop.png');
    resizeWindow(handle, 700, 560);
    await delay(400);
    await inspectLayout(page, true);
    resizeWindow(handle, 640, 480);
    await delay(400);
    await inspectLayout(page, true);
    const jumpAfterResize = await page.send('Runtime.evaluate', { expression: "Boolean(document.querySelector('.jump-latest'))", returnByValue: true });
    assert.equal(jumpAfterResize.result.value, false, 'Follow-latest state was lost during resize');
    const compactScreenshotPath = await capture(page, 'astra-lw01-compact.png');
    const cleared = await page.send('Runtime.evaluate', {
      expression: "(async () => { document.querySelectorAll('button').forEach(button => { if (button.innerText === 'Clear conversation') button.click(); }); await new Promise(resolve => setTimeout(resolve, 500)); return JSON.stringify({messages:document.querySelectorAll('.message').length,bridgeMessages:(await window.astra.getChatStatus()).messages.length}); })()",
      awaitPromise: true,
      returnByValue: true,
    });
    assert.deepEqual(JSON.parse(cleared.result.value), { messages: 0, bridgeMessages: 0 });
    assert.equal(rendererEvents.filter((event) => event.method === 'Runtime.exceptionThrown' || (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')).length, 0, `Renderer errors: ${JSON.stringify(rendererEvents)}`);
    await mkdir(evidenceDir, { recursive: true });
    const metricsPath = path.join(evidenceDir, 'astra-lw01-performance.json');
    await writeFile(metricsPath, JSON.stringify({ methodology: '30 fps capped renderer frame counter and one 1.4s idle / 1.2s first-chat CPU interval; os.cpus and free RAM are system-wide, nvidia-smi is whole GPU, Electron process tree is app-only; samples are snapshots, not attribution of GPU memory to 3D', visibilityMethod, firstReplyLatencyMs, idle: idleMetrics, firstChatWindow: generatingMetrics }, null, 2));

    console.log(`PASS: native window PID ${child.pid}, handle ${handle}; 3D canvas and capped idle frames, manual/minimized pause, live four-turn chat, scroll behavior, reset, desktop/compact layout and restricted bridge verified; visibility method: ${visibilityMethod}`);
    console.log(`Screenshots: ${screenshotPath}; ${compactScreenshotPath}`);
    console.log(`Performance: ${metricsPath}`);

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
