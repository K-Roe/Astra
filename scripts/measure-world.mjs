import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const require = createRequire(import.meta.url);
const { summarizeWorldFrames } = require('../dist-electron/shared/worldPerformance.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'test-results', 'lw02a');
const allowOccluded = process.argv.includes('--allow-occluded');
const label = process.argv.includes('--baseline') ? 'baseline' : 'candidate';

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function jsonAt(url, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const response = await fetch(url); if (response.ok) return response.json(); }
    catch { /* App is starting. */ }
    await delay(150);
  }
  throw new Error(`Timed out: ${url}`);
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
  const response = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(`Renderer evaluation failed: ${JSON.stringify(response.exceptionDetails)}`);
  return response.result.value;
}

function cpuTimes() {
  return os.cpus().reduce((total, core) => {
    total.idle += core.times.idle;
    total.all += Object.values(core.times).reduce((sum, value) => sum + value, 0);
    return total;
  }, { idle: 0, all: 0 });
}

function processResources(pid) {
  let electron = null;
  let gpu = null;
  try {
    const script = `$all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; $ids=@(${pid}); do { $next=@($all | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId } | ForEach-Object ProcessId); $ids+= $next } while ($next.Count -gt 0); $procs=@(Get-Process -Id $ids -ErrorAction SilentlyContinue); [pscustomobject]@{ count=$procs.Count; workingSetMiB=[math]::Round((($procs | Measure-Object WorkingSet64 -Sum).Sum / 1MB),1); cpuSeconds=[math]::Round((($procs | Measure-Object CPU -Sum).Sum),3) } | ConvertTo-Json -Compress`;
    electron = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }));
  } catch { /* Windows process counters unavailable. */ }
  try {
    const values = execFileSync('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.free', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).trim().split(',').map(Number);
    gpu = { utilizationPercent: values[0], usedMiB: values[1], freeMiB: values[2], scope: 'whole GPU including Ollama and other applications' };
  } catch { /* NVIDIA counters unavailable. */ }
  return { electron, gpu, systemFreeRamMiB: Math.round(os.freemem() / 1048576) };
}

function windowHandle(pid) {
  return Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).MainWindowHandle`], { encoding: 'utf8' }).trim());
}

function resizeWindow(handle, width, height) {
  const script = `$signature='[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);'; Add-Type -Name NativeResize -Namespace AstraProfile -MemberDefinition $signature; [AstraProfile.NativeResize]::MoveWindow([IntPtr]${handle}, 100, 100, ${width}, ${height}, $true)`;
  assert.equal(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim(), 'True');
}

function showWindow(handle, mode) {
  const script = `$signature='[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'; Add-Type -Name NativeShow -Namespace AstraProfile -MemberDefinition $signature; [AstraProfile.NativeShow]::ShowWindow([IntPtr]${handle}, ${mode})`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
}

async function snapshot(page) {
  return JSON.parse(await evaluate(page, "JSON.stringify({now:performance.now(),hidden:document.hidden,state:document.querySelector('.world-viewport')?.dataset.worldState,frames:Number(document.querySelector('.world-viewport')?.dataset.frameCount),chat:document.querySelector('.status')?.innerText,samples:document.querySelector('.world-viewport')?.worldSamples ?? [],pixelRatio:document.querySelector('.world-viewport canvas')?.width / document.querySelector('.world-viewport')?.getBoundingClientRect().width})"));
}

async function capture(page, filename) {
  const screenshot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await mkdir(outputDir, { recursive: true });
  const destination = path.join(outputDir, filename);
  await writeFile(destination, Buffer.from(screenshot.data, 'base64'));
  return destination;
}

async function waitForState(page, expected, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < end) {
    latest = await snapshot(page);
    if (latest.state === expected) return latest;
    await delay(100);
  }
  return latest ?? { state: null, frames: null };
}

async function measure(page, pid, name, durationMs, action) {
  const before = await snapshot(page);
  const cpuBefore = cpuTimes();
  const processBefore = processResources(pid);
  if (action) await action();
  await delay(durationMs);
  const after = await snapshot(page);
  const cpuAfter = cpuTimes();
  const processAfter = processResources(pid);
  const interval = after.samples.filter((sample) => sample.timeMs > before.now && sample.timeMs <= after.now);
  const summary = summarizeWorldFrames(interval);
  const cpuTotal = cpuAfter.all - cpuBefore.all;
  return {
    name, durationMs, before: { hidden: before.hidden, state: before.state, frames: before.frames, chat: before.chat },
    after: { hidden: after.hidden, state: after.state, frames: after.frames, chat: after.chat },
    frameSummary: summary,
    pixelRatio: after.pixelRatio,
    systemCpuPercent: cpuTotal > 0 ? Math.round(100 * (1 - (cpuAfter.idle - cpuBefore.idle) / cpuTotal)) : null,
    electronCpuSecondsDelta: processBefore.electron && processAfter.electron ? Number((processAfter.electron.cpuSeconds - processBefore.electron.cpuSeconds).toFixed(3)) : null,
    resources: processAfter,
    rawFrameSamples: interval,
  };
}

async function main() {
  const port = await freePort();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = ['.', `--remote-debugging-port=${port}`];
  if (allowOccluded) args.push('--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding');
  const child = spawn(electron, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  let browser;
  let page;
  try {
    const end = Date.now() + 15000;
    let target;
    while (Date.now() < end && !target) {
      const targets = await jsonAt(`http://127.0.0.1:${port}/json/list`);
      target = targets.find((item) => item.type === 'page' && item.title === 'ASTRA');
      if (!target) await delay(150);
    }
    assert(target, 'No Astra renderer target');
    const version = await jsonAt(`http://127.0.0.1:${port}/json/version`);
    browser = connect(version.webSocketDebuggerUrl);
    page = connect(target.webSocketDebuggerUrl);
    await Promise.all([browser.ready, page.ready]);
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    const handle = windowHandle(child.pid);
    assert(handle > 0, 'No native Windows Astra window');
    const readyEnd = Date.now() + 15000;
    while (Date.now() < readyEnd) {
      const state = await snapshot(page);
      if (state.chat === 'Ready' && state.samples.length > 0) break;
      await delay(150);
    }
    const nativeVisibility = await snapshot(page);
    let visibilityMethod = 'native';
    if (nativeVisibility.hidden && allowOccluded) {
      await page.send('Page.setWebLifecycleState', { state: 'active' });
      await delay(250);
      if ((await snapshot(page)).hidden) {
        await evaluate(page, "Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); true");
        visibilityMethod = 'test-only document.hidden override with backgrounding disabled';
      } else visibilityMethod = 'CDP active lifecycle with backgrounding disabled';
    }
    const visible = await snapshot(page);
    assert(visible.state === 'running', `Scene cannot run: ${JSON.stringify({ nativeVisibility, visible })}`);
    const results = [];
    results.push(await measure(page, child.pid, 'idle_desktop', 3000));
    const desktopScreenshot = await capture(page, 'astra-lw02a-desktop.png');
    const input = 'For this local performance test, explain in six concise sentences what Astra can and cannot remember between sessions.';
    await evaluate(page, `(() => { const input = document.querySelector('#message-input'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(input)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await delay(100);
    await evaluate(page, "document.querySelector('.composer').requestSubmit()");
    results.push(await measure(page, child.pid, 'gemma_generating', 1700));
    const replyDeadline = Date.now() + 120000;
    while (Date.now() < replyDeadline && (await snapshot(page)).chat === 'Generating') await delay(200);
    assert.equal((await snapshot(page)).chat, 'Ready', 'Gemma did not finish reply');
    results.push(await measure(page, child.pid, 'gemma_finished', 3000));
    resizeWindow(handle, 640, 480);
    results.push(await measure(page, child.pid, 'compact', 3000));
    const compactScreenshot = await capture(page, 'astra-lw02a-compact.png');
    showWindow(handle, 6);
    results.push(await measure(page, child.pid, 'minimized', 700));
    showWindow(handle, 9);
    results.push(await measure(page, child.pid, 'restored', 2500));
    await evaluate(page, "document.querySelector('.world-pause')?.click()");
    results.push(await measure(page, child.pid, 'manual_paused', 700));
    await evaluate(page, "document.querySelector('.world-pause')?.click()");
    results.push(await measure(page, child.pid, 'manual_resumed', 2500));
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reducedState = await waitForState(page, 'reduced-motion', 4000);
    assert.equal(reducedState.state, 'reduced-motion', 'Emulated reduced motion did not pause the scene');
    await delay(600);
    const reducedAfter = await snapshot(page);
    assert.equal(reducedAfter.frames, reducedState.frames, 'Reduced-motion scene continued rendering');
    await page.send('Emulation.setEmulatedMedia', { features: [] });
    const resumedState = await waitForState(page, 'running', 4000);
    assert.equal(resumedState.state, 'running', 'Scene did not resume after reduced-motion emulation');
    assert(resumedState.frames > reducedAfter.frames, 'Scene did not render new frames after resuming');
    await mkdir(outputDir, { recursive: true });
    const output = path.join(outputDir, `${label}${allowOccluded ? '-occluded' : '-native'}-performance.json`);
    await writeFile(output, JSON.stringify({ label, visibilityMethod, nativeVisibility: { hidden: nativeVisibility.hidden, state: nativeVisibility.state }, screenshots: [desktopScreenshot, compactScreenshot], reducedMotion: { method: 'CDP media emulation with a renderer-side state re-check', pausedState: reducedState.state, framesDuringPause: reducedAfter.frames - reducedState.frames, resumedState: resumedState.state, framesAfterResume: resumedState.frames - reducedAfter.frames }, note: 'Frame intervals include timer scheduling; renderCpuMs is renderer.render CPU wall time, not GPU time. GPU samples are whole-system. Test-only visibility override is not native foreground acceptance.', results }, null, 2));
    console.log(`Performance written: ${output}`);
    console.log(`Screenshots: ${desktopScreenshot}; ${compactScreenshot}`);
    for (const result of results) console.log(`${result.name}: ${JSON.stringify({ state: result.after.state, chat: result.after.chat, fps: result.frameSummary.averageFps, p95Ms: result.frameSummary.p95IntervalMs, renderCpuMs: result.frameSummary.averageRenderCpuMs, frames: result.after.frames - result.before.frames, gpu: result.resources.gpu })}`);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) return null; return original.call(this, type, ...args); }; })();" });
    await page.send('Page.reload');
    const fallbackDeadline = Date.now() + 10000;
    let fallback;
    while (Date.now() < fallbackDeadline) {
      try {
        fallback = await evaluate(page, "JSON.stringify({ text:document.querySelector('.world-unavailable')?.innerText, state:document.querySelector('.world-viewport')?.dataset.worldState, chat:document.querySelector('.status')?.innerText })");
        if (fallback && JSON.parse(fallback).state === 'unavailable') break;
      } catch { /* Reload is in progress. */ }
      await delay(150);
    }
    const fallbackState = JSON.parse(fallback ?? '{}');
    assert.equal(fallbackState.state, 'unavailable', `No WebGL fallback: ${fallback}`);
    assert.match(fallbackState.text, /Chat remains available/);
    assert.equal(fallbackState.chat, 'Ready');
    console.log(`PASS: reduced-motion media emulation paused/resumed; WebGL-disabled reload showed text fallback with ready chat`);
    const closed = await browser.send('Target.closeTarget', { targetId: target.id });
    assert.equal(closed.success, true);
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(10000).then(() => { throw new Error('Electron did not exit'); })]);
  } catch (error) {
    console.error(`Electron stderr: ${stderr}`);
    throw error;
  } finally {
    page?.close();
    browser?.close();
    if (child.exitCode === null) child.kill();
  }
}

await main();
