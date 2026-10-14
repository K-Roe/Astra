/** Native, disposable-profile observation of LW-03's autonomous home life. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = mkdtempSync(path.join(os.tmpdir(), 'astra-lw03-idle-'));
const output = path.join(root, 'test-results', 'lw03');
const review = path.join(root, 'docs', 'review', 'lw03');
mkdirSync(output, { recursive: true });
mkdirSync(review, { recursive: true });

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function jsonAt(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(url); if (response.ok) return response.json(); }
    catch { /* Electron is starting. */ }
    await delay(150);
  }
  throw new Error(`Timed out at ${url}`);
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
        const callId = ++id;
        pending.set(callId, { resolve, reject });
        socket.send(JSON.stringify({ id: callId, method, params }));
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
async function state(page) {
  return JSON.parse(await evaluate(page, "(()=>{const v=document.querySelector('.world-viewport');const d=v?.astraDiagnostics;return JSON.stringify({visible:!document.hidden,world:v?.dataset.worldState,asset:v?.dataset.characterAsset,activity:v?.dataset.activity,fps:Number(v?.dataset.fps),frames:Number(v?.dataset.frameCount),state:d?.state,clip:d?.clip,waypoint:d?.waypoint,x:d?.x,z:d?.z})})()"));
}
async function screenshot(page, name) {
  const result = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(review, name), Buffer.from(result.data, 'base64'));
}
function resources(pid) {
  let appWorkingSetMiB = null;
  try {
    const script = `$all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; $ids=@(${pid}); do { $next=@($all | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId } | ForEach-Object ProcessId); $ids+= $next } while ($next.Count -gt 0); $procs=@(Get-Process -Id $ids -ErrorAction SilentlyContinue); [math]::Round((($procs | Measure-Object WorkingSet64 -Sum).Sum / 1MB),1)`;
    appWorkingSetMiB = Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim());
  } catch { /* Process counters unavailable. */ }
  let wholeGpu = null;
  try {
    const values = execFileSync('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).trim().split(',').map(Number);
    wholeGpu = { utilizationPercent: values[0], usedMiB: values[1] };
  } catch { /* GPU counters unavailable. */ }
  return { appWorkingSetMiB, wholeGpu, systemFreeRamMiB: Math.round(os.freemem() / 1048576) };
}

const port = await freePort();
const env = { ...process.env, ASTRA_CA01_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', '--ca01-acceptance', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', `--remote-debugging-port=${port}`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let page;
let browser;
let target;
try {
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    const targets = await jsonAt(`http://127.0.0.1:${port}/json/list`);
    target = targets.find((item) => item.type === 'page' && item.title === 'ASTRA');
    if (!target) await delay(150);
  }
  assert(target, 'Astra window did not render');
  const version = await jsonAt(`http://127.0.0.1:${port}/json/version`);
  browser = connect(version.webSocketDebuggerUrl);
  page = connect(target.webSocketDebuggerUrl);
  await Promise.all([browser.ready, page.ready]);
  let selected = false;
  for (let attempt = 0; attempt < 80 && !selected; attempt++) {
    selected = await evaluate(page, "(()=>{const s=document.querySelector('.character-version-select select');if(!s)return false;s.value='astra-character-v2';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
    if (!selected) await delay(150);
  }
  assert(selected, 'Character selector did not render');
  let ready;
  for (let attempt = 0; attempt < 80; attempt++) {
    ready = await state(page);
    if (ready.asset === 'ready' && ready.world === 'running' && await evaluate(page, "document.querySelector('.character-version-select select')?.value==='astra-character-v2'")) break;
    await delay(150);
  }
  assert(ready.asset === 'ready' && ready.world === 'running', `V2 native scene unavailable: ${JSON.stringify(ready)}`);
  await screenshot(page, 'home-overview-native.png');
  const observed = { start: ready, walk: null, sofa: null, stood: null, maxStepMetres: 0, frames: [] };
  let previous = ready;
  let previousAt = Date.now();
  const deadline = Date.now() + 210000;
  while (Date.now() < deadline && !observed.stood) {
    await delay(250);
    const current = await state(page);
    const currentAt = Date.now();
    if (current.world !== 'running') {
      // The window can be occluded or minimised by the desktop; rendering is
      // paused by design then, which is not an idle-behaviour failure.
      if (current.world === 'hidden' || current.visible === false) {
        observed.pausedForHidden = (observed.pausedForHidden ?? 0) + 1;
      } else {
        throw new Error(`scene stopped while observing idle: ${JSON.stringify(current)}`);
      }
    }
    const step = Math.hypot(current.x - previous.x, current.z - previous.z);
    const gapSeconds = (currentAt - previousAt) / 1000;
    observed.maxStepMetres = Math.max(observed.maxStepMetres, step);
    // Each sample costs a CDP round trip, so this bounds ground speed rather
    // than measuring it exactly. Walking is 0.62 m/s; anything beyond a
    // running pace between two observations would be a teleport.
    const allowed = gapSeconds * 1.4 + 0.2;
    if (current.world === 'running' && step > allowed) throw new Error(`character moved ${step.toFixed(3)} m in ${gapSeconds.toFixed(2)} s, faster than walking between native observations`);
    if (current.fps > 0) observed.frames.push(current.fps);
    if (!observed.walk && current.state === 'walking') {
      observed.walk = { ...current, resources: resources(child.pid) };
      await screenshot(page, 'walking-native.png');
      await evaluate(page, "document.querySelector('[aria-label=\"Follow Astra with the camera\"]')?.click(); true");
      await delay(900);
      await screenshot(page, 'walking-follow-native.png');
      await evaluate(page, "document.querySelector('[aria-label=\"Reset camera to automatic framing\"]')?.click(); true");
    }
    if (!observed.sofa && current.state === 'seated' && current.waypoint === 'sofa_seat') {
      observed.sofa = { ...current, resources: resources(child.pid) };
      await screenshot(page, 'sofa-native.png');
    }
    if (observed.sofa && current.state === 'standing_up') {
      observed.stood = { ...current, resources: resources(child.pid) };
      await screenshot(page, 'sofa-stand-native.png');
    }
    previous = current;
    previousAt = currentAt;
  }
  const summary = {
    startedAt: new Date().toISOString(),
    observed,
    idleResources: resources(child.pid),
    averageDisplayedFps: observed.frames.length ? Number((observed.frames.reduce((a, b) => a + b, 0) / observed.frames.length).toFixed(1)) : null,
    note: 'Native Electron with disposable profile; GPU values are whole-device, including Ollama and other apps. State comes from the single renderer character controller.',
  };
  writeFileSync(path.join(output, 'idle-native.json'), JSON.stringify(summary, null, 2));
  assert(observed.walk, 'No autonomous walk observed');
  assert(observed.sofa, 'No autonomous sofa sit observed within 210 seconds');
  assert(observed.stood, 'Astra did not stand after relaxing on the sofa within 210 seconds');
  console.log(`PASS LW-03 idle: walk, sofa sit, stand; max observed step ${observed.maxStepMetres.toFixed(3)} m; ${summary.averageDisplayedFps} displayed fps`);
  console.log(`Evidence: ${path.join(output, 'idle-native.json')}`);
  await browser.send('Target.closeTarget', { targetId: target.id });
  if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(10000).then(() => { throw new Error('Electron did not exit'); })]);
  assert.equal(child.exitCode, 0);
} finally {
  page?.close();
  browser?.close();
  if (child.exitCode === null) child.kill();
  if (path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith('astra-lw03-idle-')) {
    // Chromium can still hold profile files for a moment after exit. The
    // profile is disposable and inside the system temp directory, so a failed
    // cleanup is reported rather than allowed to fail the acceptance run.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (error) {
      console.warn(`Disposable profile left for the OS to clean: ${profile} (${error.code ?? error.message})`);
    }
  }
}
