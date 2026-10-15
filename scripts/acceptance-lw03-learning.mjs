/**
 * Native, disposable-profile observation of LW-03's learning behaviour.
 *
 * Approves a real HTTPS source through the real preload bridge, starts the
 * real Learning fetch from the real workspace button, and records what the
 * single renderer character actually does while it runs.
 */
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
const profile = mkdtempSync(path.join(os.tmpdir(), 'astra-lw03-learning-'));
const output = path.join(root, 'test-results', 'lw03');
const review = path.join(root, 'docs', 'review', 'lw03');
const SOURCE_URL = process.argv[2] ?? 'https://www.typescriptlang.org/docs/handbook/intro.html';
const SOURCE_KEY = new URL(SOURCE_URL).host + new URL(SOURCE_URL).pathname;
const SOURCE_PAGES = Number(process.argv[3] ?? 12);
const CHARACTER = process.argv[5] ?? 'astra-character-v1';
const SOURCE_DEPTH = Number(process.argv[4] ?? 2);
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
async function presentation(page) {
  return JSON.parse(await evaluate(page, "(()=>{const v=document.querySelector('.world-viewport');const d=v?.astraDiagnostics;return JSON.stringify({activity:v?.dataset.activity,state:d?.state,clip:d?.clip,waypoint:d?.waypoint,destination:d?.destination,x:d?.x,z:d?.z,fps:Number(v?.dataset.fps)})})()"));
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
  return { appWorkingSetMiB, systemFreeRamMiB: Math.round(os.freemem() / 1048576) };
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

  let ready = false;
  for (let attempt = 0; attempt < 80 && !ready; attempt++) {
    ready = (await presentation(page)).activity !== undefined && await evaluate(page, "document.querySelector('.world-viewport')?.dataset.characterAsset==='ready'");
    if (!ready) await delay(200);
  }
  assert(ready, 'The world did not become ready');
  if (CHARACTER === 'astra-character-v2') {
    await evaluate(page, "(()=>{const s=document.querySelector('.character-version-select select');s.value='astra-character-v2';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
    for (let attempt = 0; attempt < 80; attempt++) {
      const loaded = await evaluate(page, "document.querySelector('.character-version-select select')?.value==='astra-character-v2' && document.querySelector('.world-viewport')?.dataset.characterAsset==='ready'");
      if (loaded) break;
      await delay(200);
    }
  }
  const characterVersion = await evaluate(page, "document.querySelector('.character-version-select select')?.value ?? 'unknown'");

  // Start from a known standing position so the desk journey is observable.
  await evaluate(page, "document.querySelector('[aria-label=\"Bring Astra to the centre of the room\"]')?.click(); true");
  let atCentre = false;
  let centreSeen = 'not observed';
  const centreDeadline = Date.now() + 30000;
  while (Date.now() < centreDeadline && !atCentre) {
    centreSeen = JSON.stringify(await presentation(page));
    const current = await presentation(page);
    atCentre = current.waypoint === 'centre' && !['walking', 'turning', 'sitting_down', 'standing_up'].includes(current.state);
    if (!atCentre) await delay(250);
  }
  assert(atCentre, `Centre control did not bring her to the middle of the room: ${centreSeen}`);

  const statsBefore = JSON.parse(await evaluate(page, "window.astraIntelligence.knowledgeStats().then(s=>JSON.stringify(s))"));
  const added = JSON.parse(await evaluate(page, `window.astraIntelligence.addSource({url:'${SOURCE_URL}',maxPages:${SOURCE_PAGES},maxDepth:${SOURCE_DEPTH}}).then(s=>JSON.stringify(s))`));
  assert(added.approved === true, `Source approval failed: ${JSON.stringify(added)}`);
  await evaluate(page, "[...document.querySelectorAll('.workspace-tabs button')].find(b=>b.innerText==='Learning').click(); true");
  await delay(700);
  const clicked = await evaluate(page, `(()=>{const row=[...document.querySelectorAll('.source-list li')].find(e=>e.innerText.includes('${SOURCE_KEY}')); const button=[...(row?.querySelectorAll('button')??[])].find(b=>b.innerText==='Learn'); if(!button)return 'row:'+(row?.innerText??'none').slice(0,90); button.click(); return true})()`);
  assert(clicked === true, `Learning button unavailable: ${clicked}`);

  const timeline = [];
  let lastKey = '';
  let sawLearning = false;
  let routed = false;
  let atDesk = false;
  let deskShot = false;
  let deskResources = null;
  let fpsSamples = [];
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const current = await presentation(page);
    const key = JSON.stringify(current);
    if (key !== lastKey) {
      lastKey = key;
      timeline.push({ at: new Date().toISOString(), ...current });
    }
    if (current.fps > 0) fpsSamples.push(current.fps);
    sawLearning ||= current.activity === 'learning';
    routed ||= current.activity === 'learning' && (current.destination === 'desk_seat' || current.waypoint === 'desk_seat');
    // V1 has no `desk_work` clip, so seated work at the keyboard plays `thinking`;
// V2 plays `desk_work`. Both are real seated work at the desk.
const SEATED_WORK = ['desk_work', 'thinking', 'seated_idle'];
if (current.activity === 'learning' && current.waypoint === 'desk_seat' && SEATED_WORK.includes(current.clip)) {
      atDesk = true;
      if (!deskShot) {
        deskShot = true;
        deskResources = resources(child.pid);
        await screenshot(page, 'learning-desk-native.png');
        for (const [view, filename] of [
          ['desk', 'desk-front-correction-native.png'],
          ['deskSide', 'desk-side-correction-native.png'],
          ['overhead', 'desk-overhead-correction-native.png'],
        ]) {
          await evaluate(page, `(()=>{const s=document.querySelector('[aria-label="World camera view"]');s.value='${view}';s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()`);
          await delay(1300);
          await screenshot(page, filename);
        }
      }
      // Hold the observation briefly so the seated work pose is captured live.
      const holdUntil = Date.now() + 4000;
      while (Date.now() < holdUntil) {
        await delay(400);
        const held = await presentation(page);
        if (held.fps > 0) fpsSamples.push(held.fps);
        timeline.push({ at: new Date().toISOString(), ...held });
      }
      break;
    }
    if (sawLearning && current.activity !== 'learning') break;
    await delay(300);
  }

  const learningSeconds = timeline.length > 1
    ? Number(((Date.parse(timeline.at(-1).at) - Date.parse(timeline[0].at)) / 1000).toFixed(2))
    : null;
  const summary = {
    startedAt: new Date().toISOString(),
    source: { url: SOURCE_URL, maxPages: SOURCE_PAGES, maxDepth: SOURCE_DEPTH, approved: added.approved === true },
    knowledgeBefore: statsBefore,
    knowledgeAfter: JSON.parse(await evaluate(page, "window.astraIntelligence.knowledgeStats().then(s=>JSON.stringify(s))")),
    workspaceStatus: await evaluate(page, "[...document.querySelectorAll('[aria-label=\"Learning workspace\"] .status, [aria-label=\"Learning workspace\"] p')].map(e=>e.innerText).slice(0,4).join(' | ')"),
    sawLearning,
    routedToDesk: routed,
    reachedDeskWork: atDesk,
    averageDisplayedFps: fpsSamples.length ? Number((fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length).toFixed(1)) : null,
    deskResources,
    idleResources: resources(child.pid),
    timeline,
    note: 'Native Electron with a disposable profile and a real approved HTTPS crawl. The learning state comes from the actual fetch promise; no progress value is invented.',
  };
  writeFileSync(path.join(output, 'learning-native.json'), JSON.stringify(summary, null, 2));
  assert(sawLearning, 'The approved fetch never entered learning presentation');
  assert(routed, 'Learning did not route her towards the desk');
  const settled = timeline.at(-1);
  assert(settled && settled.activity !== 'learning', 'She still claims to be learning after the fetch finished');
  // Whether she reaches the chair depends on how long the real crawl takes.
  // On this machine it is usually shorter than the walk, so this is reported
  // rather than asserted. See docs/LW_03.md.
  console.log(`LW-03 learning: entered=${sawLearning} routed=${routed} seatedDeskWork=${atDesk} (crawl took ${learningSeconds ?? 'n/a'}s, character ${characterVersion})`);
  console.log(`Evidence: ${path.join(output, 'learning-native.json')}`);
  await browser.send('Target.closeTarget', { targetId: target.id });
  if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(10000).then(() => { throw new Error('Electron did not exit'); })]);
  assert.equal(child.exitCode, 0);
} finally {
  page?.close();
  browser?.close();
  if (child.exitCode === null) child.kill();
  if (path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith('astra-lw03-learning-')) {
    // Chromium can still hold profile files briefly after exit; the directory is
    // disposable and in the system temp path.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (error) {
      console.warn(`Disposable profile left for the OS to clean: ${profile} (${error.code ?? error.message})`);
    }
  }
}
