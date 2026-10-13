import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { clearInterval, setInterval, setTimeout } from 'node:timers';
import { promisify, TextDecoder } from 'node:util';

const execFileAsync = promisify(execFile);
const baseUrl = 'http://127.0.0.1:11434';
const allowedModels = new Set(['gemma3:4b', 'qwen2.5-coder:7b']);
const model = process.argv[2];
const mode = process.argv[3] ?? 'standard';
if (!allowedModels.has(model) || !['standard', 'repeat', 'reasoning-512'].includes(mode)) {
  throw new Error('Usage: node scripts/benchmark-ollama.mjs gemma3:4b|qwen2.5-coder:7b [repeat|reasoning-512]');
}

const system = 'You are Astra, a calm, clear local AI companion. Be honest about uncertainty. You have no personal memory or access to files or tools in this test. Never invent prior conversations or completed actions. Follow the user requested format.';
const options = { num_ctx: 4096, num_predict: mode === 'reasoning-512' ? 512 : 256, temperature: 0, seed: 42 };
const allCases = [
  {
    id: 'natural_conversation',
    prompt: 'I am stuck on a bug and feeling frustrated. How would you help me get unstuck? Answer in three short sentences.',
    expected: 'Empathetic, concrete, concise help without claiming tool access.',
  },
  {
    id: 'personality_and_honesty',
    prompt: 'We have never spoken before. Tell me what you remember about my past projects and whether you can access my files. Respond in two sentences.',
    expected: 'No invented memory or file access; two sentences.',
  },
  {
    id: 'coding',
    prompt: 'Write a TypeScript function dedupeById<T extends { id: string }>(items: readonly T[]): T[] that preserves the first occurrence of each id and input order. Return code only, without Markdown.',
    expected: 'Type-correct implementation using a Set; first occurrence and order preserved; code only.',
  },
  {
    id: 'reasoning',
    prompt: 'A queue has 90 pending jobs. A worker completes 18 jobs per minute while 6 new jobs arrive per minute. Assuming constant rates, how many minutes until the queue is empty? Show the calculation.',
    expected: 'Net rate 12 jobs/minute; 90/12 = 7.5 minutes.',
  },
  {
    id: 'instruction_following',
    prompt: 'Reply with exactly one line of valid JSON with keys "status" and "count", values "ready" and 3. No Markdown and no other text.',
    expected: '{"status":"ready","count":3} (key order unimportant).',
  },
];
const cases = mode === 'reasoning-512' ? allCases.filter((item) => item.id === 'reasoning') : allCases;

async function api(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status} ${await response.text()}`);
  return response;
}

async function apiJson(route, body) {
  return await (await api(route, body)).json();
}

function cpuTimes() {
  return os.cpus().reduce((totals, core) => {
    const values = core.times;
    totals.idle += values.idle;
    totals.total += values.user + values.nice + values.sys + values.idle + values.irq;
    return totals;
  }, { idle: 0, total: 0 });
}

async function gpuSample() {
  const { stdout } = await execFileAsync('nvidia-smi', [
    '--query-gpu=memory.used,utilization.gpu', '--format=csv,noheader,nounits',
  ], { timeout: 5000 });
  const [usedMiB, utilizationPct] = stdout.trim().split(',').map((part) => Number(part.trim()));
  assert(Number.isFinite(usedMiB) && Number.isFinite(utilizationPct));
  return { usedMiB, utilizationPct };
}

function startSampler() {
  const samples = [];
  let previousCpu = cpuTimes();
  let active = true;
  let busy = false;
  const tick = async () => {
    if (!active || busy) return;
    busy = true;
    try {
      const gpu = await gpuSample();
      const currentCpu = cpuTimes();
      const totalDelta = currentCpu.total - previousCpu.total;
      const idleDelta = currentCpu.idle - previousCpu.idle;
      previousCpu = currentCpu;
      samples.push({
        at: new Date().toISOString(),
        gpuUsedMiB: gpu.usedMiB,
        gpuUtilizationPct: gpu.utilizationPct,
        systemCpuPct: totalDelta > 0 ? Math.round(1000 * (1 - idleDelta / totalDelta)) / 10 : null,
        availableRamMiB: Math.round(os.freemem() / 1024 / 1024),
      });
    } catch (error) {
      samples.push({ at: new Date().toISOString(), sampleError: String(error) });
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, 750);
  void tick();
  return {
    samples,
    async stop() {
      active = false;
      clearInterval(timer);
      while (busy) await new Promise((resolve) => setTimeout(resolve, 25));
    },
  };
}

async function runPrompt(prompt) {
  const started = performance.now();
  const response = await api('/api/chat', {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    options,
    stream: true,
    keep_alive: '10m',
  });
  assert(response.body, 'Ollama returned no response stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let firstTokenMs = null;
  let output = '';
  let final = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      const content = event.message?.content ?? '';
      if (content && firstTokenMs === null) firstTokenMs = performance.now() - started;
      output += content;
      if (event.done) final = event;
    }
  }
  assert(final, 'Ollama stream ended without final metrics');
  return {
    output,
    wallMs: Math.round(performance.now() - started),
    firstTokenMs: firstTokenMs === null ? null : Math.round(firstTokenMs),
    totalMs: Math.round(final.total_duration / 1e6),
    loadMs: Math.round(final.load_duration / 1e6),
    promptTokens: final.prompt_eval_count,
    promptEvalMs: Math.round(final.prompt_eval_duration / 1e6),
    outputTokens: final.eval_count,
    generationMs: Math.round(final.eval_duration / 1e6),
    tokensPerSecond: final.eval_duration > 0 ? Math.round(10 * final.eval_count / (final.eval_duration / 1e9)) / 10 : null,
    doneReason: final.done_reason,
  };
}

const loadedBefore = await apiJson('/api/ps');
assert.equal(loadedBefore.models.length, 0, 'Another model is loaded; stop to avoid disruption');
const tags = await apiJson('/api/tags');
const matchingTags = tags.models.filter((entry) => entry.name === model);
assert.equal(matchingTags.length, 1, `${model} must resolve to exactly one local digest; found ${matchingTags.length}`);
const installed = matchingTags[0];
const show = await apiJson('/api/show', { model });
const baselineGpu = await gpuSample();
const sampler = startSampler();
const results = {
  timestamp: new Date().toISOString(),
  ollamaVersion: (await apiJson('/api/version')).version,
  model,
  mode,
  digest: installed.digest,
  sizeBytes: installed.size,
  details: show.details,
  nativeContext: show.model_info?.[`${show.details.family}.context_length`] ?? null,
  settings: { ...options, stream: true, keep_alive: '10m', endpoint: '/api/chat' },
  system,
  baselineGpu,
  warmup: null,
  loadedAfterWarmup: null,
  cases: [],
  samples: sampler.samples,
};

try {
  console.log(`Running ${model} alone; baseline GPU memory ${baselineGpu.usedMiB} MiB`);
  results.warmup = await runPrompt('Reply with READY.');
  results.loadedAfterWarmup = await apiJson('/api/ps');
  console.log(`Warmup: ${results.warmup.wallMs} ms, model load ${results.warmup.loadMs} ms`);
  for (const item of cases) {
    const metrics = await runPrompt(item.prompt);
    results.cases.push({ ...item, ...metrics });
    console.log(`${item.id}: ${metrics.wallMs} ms, first token ${metrics.firstTokenMs} ms, ${metrics.tokensPerSecond} tokens/s`);
  }
} finally {
  await sampler.stop();
  await execFileAsync('ollama', ['stop', model], { timeout: 15000 });
  results.loadedAfterUnload = await apiJson('/api/ps');
  assert.equal(results.loadedAfterUnload.models.some((entry) => entry.name === model), false, `${model} remained loaded after stop`);
  results.tagsAfter = (await apiJson('/api/tags')).models.filter((entry) => entry.name === model).map((entry) => ({ digest: entry.digest, modified_at: entry.modified_at }));
  results.tagStable = results.tagsAfter.length === 1 && results.tagsAfter[0].digest === installed.digest;
  const outputDir = path.resolve('test-results');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `ollama-${model.replace(/[^a-z0-9]+/gi, '-')}${mode === 'standard' ? '' : `-${mode}`}.json`);
  await writeFile(outputPath, JSON.stringify(results, null, 2) + '\n', 'utf8');
  console.log(`Saved ${outputPath}; loaded models after unload: ${results.loadedAfterUnload.models.length}`);
}
