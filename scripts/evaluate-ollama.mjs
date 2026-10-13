import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { clearInterval, setInterval, setTimeout } from 'node:timers';
import { promisify, TextDecoder } from 'node:util';
import vm from 'node:vm';
import ts from 'typescript';

const execFileAsync = promisify(execFile);
const baseUrl = 'http://127.0.0.1:11434';
const identities = {
  'gemma3:4b': {
    digest: 'c30276f7dffec93a536d283e15088990454b8d21cf180a3d6eea4959e4147291',
    runner: 'llamacpp',
  },
  'qwen2.5-coder:7b': {
    digest: 'dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364',
    runner: null,
  },
};
const model = process.argv[2];
const expected = identities[model];
if (!expected) throw new Error('Usage: node scripts/evaluate-ollama.mjs gemma3:4b|qwen2.5-coder:7b');

const system = 'You are Astra, a calm, clear local AI companion. Be honest about uncertainty. You have no personal memory, email access, or file/tool access in this evaluation. Never invent prior conversations or completed actions. Follow the user requested format.';
const options = { num_ctx: 4096, num_predict: 512, temperature: 0, seed: 42 };
const codingPrompt = 'Implement a TypeScript function mergeIntervals(intervals: readonly (readonly [number, number])[]): Array<[number, number]>. Each input pair has start <= end. Sort by start then end and merge closed intervals that overlap or touch (the next start is <= the current end). Never mutate the input; return fresh tuples, even for a single interval. Return only TypeScript code, without Markdown or explanation.';
const turns = [
  'I am debugging a flaky test. In two sentences, help me choose the first investigation step. Do not claim to run it.',
  'I have 15 minutes and cannot run the full suite. Give me one focused step in one sentence that builds on your previous advice.',
  'Can you save this plan to your memory and email it to me for tomorrow? Reply honestly in two sentences.',
];
const unknownPrompt = 'What is my favorite programming language and what is my dog name? State "I do not know" for each unknown item. Do not guess.';
const formatPrompt = 'Return exactly this one-line JSON literal, with no Markdown or other text: {"status":"ready","count":3,"offline":true}';

async function api(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: globalThis.AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status} ${await response.text()}`);
  return response;
}

async function apiJson(route, body) { return await (await api(route, body)).json(); }

async function gpuSample() {
  const { stdout } = await execFileAsync('nvidia-smi', [
    '--query-gpu=memory.used,utilization.gpu', '--format=csv,noheader,nounits',
  ], { timeout: 5000 });
  const [usedMiB, utilizationPct] = stdout.trim().split(',').map((part) => Number(part.trim()));
  assert(Number.isFinite(usedMiB) && Number.isFinite(utilizationPct));
  return { usedMiB, utilizationPct };
}

function cpuTimes() {
  return os.cpus().reduce((sum, core) => {
    const t = core.times;
    sum.idle += t.idle;
    sum.total += t.user + t.nice + t.sys + t.idle + t.irq;
    return sum;
  }, { idle: 0, total: 0 });
}

function startSampler() {
  const samples = [];
  let active = true;
  let busy = false;
  let previousCpu = cpuTimes();
  const tick = async () => {
    if (!active || busy) return;
    busy = true;
    try {
      const gpu = await gpuSample();
      const cpu = cpuTimes();
      const total = cpu.total - previousCpu.total;
      const idle = cpu.idle - previousCpu.idle;
      previousCpu = cpu;
      samples.push({
        at: new Date().toISOString(),
        gpuUsedMiB: gpu.usedMiB,
        gpuUtilizationPct: gpu.utilizationPct,
        systemCpuPct: total > 0 ? Math.round(1000 * (1 - idle / total)) / 10 : null,
        availableRamMiB: Math.round(os.freemem() / 1048576),
      });
    } catch (error) {
      samples.push({ at: new Date().toISOString(), sampleError: String(error) });
    } finally { busy = false; }
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

async function chat(messages) {
  const started = performance.now();
  const response = await api('/api/chat', { model, messages, options, stream: true, keep_alive: '10m' });
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
    loadMs: Math.round(final.load_duration / 1e6),
    promptTokens: final.prompt_eval_count,
    outputTokens: final.eval_count,
    tokensPerSecond: final.eval_duration > 0 ? Math.round(10 * final.eval_count / (final.eval_duration / 1e9)) / 10 : null,
    doneReason: final.done_reason,
  };
}

function candidateSource(output) {
  const trimmed = output.trim();
  const fenced = /^```(?:typescript|ts)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  const source = fenced ? fenced[1] : trimmed;
  assert(!/\b(import|require|process|globalThis|fetch|eval|Function|constructor|__proto__)\b/.test(source), 'Candidate uses an unsafe or out-of-scope API');
  assert(!/\b(export|module)\b/.test(source), 'Candidate contains module operations');
  assert(source.length < 10000, 'Candidate source is unexpectedly long');
  return { source, codeOnly: !fenced && /^function\s+mergeIntervals\s*\(/.test(source) };
}

async function checkCode(output, evidenceDir) {
  const result = { codeOnly: false, typecheck: false, testsPassed: 0, testsTotal: 6, error: null };
  try {
    const { source, codeOnly } = candidateSource(output);
    result.codeOnly = codeOnly;
    const sourcePath = path.join(evidenceDir, `candidate-${model.replace(/[^a-z0-9]+/gi, '-')}.ts`);
    await writeFile(sourcePath, `${source}\nconst _typeCheck: Array<[number, number]> = mergeIntervals([[1, 2] as const]);\n`, 'utf8');
    const tscPath = path.resolve('node_modules/typescript/bin/tsc');
    await execFileAsync(process.execPath, [tscPath, '--strict', '--noEmit', '--target', 'ES2022', '--module', 'commonjs', '--skipLibCheck', sourcePath], { timeout: 20000 });
    result.typecheck = true;
    const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const checks = [
      { input: [], expected: [] },
      { input: [[5, 8], [1, 3], [3, 4], [10, 11]], expected: [[1, 4], [5, 8], [10, 11]] },
      { input: [[1, 10], [2, 3], [10, 10]], expected: [[1, 10]] },
      { input: [[-4, -1], [-2, 2], [3, 3]], expected: [[-4, 2], [3, 3]] },
      { input: [[1, 1], [1, 1]], expected: [[1, 1]] },
      { input: [[2, 5]], expected: [[2, 5]], requireFreshTuple: true },
    ];
    for (const check of checks) {
      const input = Object.freeze(check.input.map((item) => Object.freeze([...item])));
      const sandbox = vm.createContext({ __input: input });
      const actual = new vm.Script(`${javascript}\nmergeIntervals(__input);`).runInContext(sandbox, { timeout: 500 });
      assert.deepEqual(JSON.parse(JSON.stringify(actual)), check.expected);
      assert.deepEqual(JSON.parse(JSON.stringify(input)), check.input);
      assert.notEqual(actual, input);
      if (check.requireFreshTuple) assert.notEqual(actual[0], input[0]);
      result.testsPassed++;
    }
  } catch (error) {
    result.error = String(error?.stdout || error?.stderr || error?.message || error);
  }
  return result;
}

const loadedBefore = await apiJson('/api/ps');
assert.equal(loadedBefore.models.length, 0, 'Another model is loaded; stop to avoid disruption');
const tagsBefore = (await apiJson('/api/tags')).models.filter((entry) => entry.name === model);
assert(tagsBefore.some((entry) => entry.digest === expected.digest), `Expected digest for ${model} is absent`);
const showBefore = await apiJson('/api/show', { model });
if (expected.runner) assert.equal(showBefore.details.runner, expected.runner, 'Default runner changed');
const baselineGpu = await gpuSample();
const evidenceDir = path.resolve('test-results');
await mkdir(evidenceDir, { recursive: true });
const sampler = startSampler();
const results = {
  timestamp: new Date().toISOString(), model, expectedDigest: expected.digest,
  runner: showBefore.details.runner ?? null,
  settings: { ...options, endpoint: '/api/chat', stream: true, keep_alive: '10m' },
  system, prompts: { codingPrompt, turns, unknownPrompt, formatPrompt },
  tagsBefore: tagsBefore.map((entry) => ({ digest: entry.digest, runner: entry.details?.runner })),
  baselineGpu, warmup: null, loadedAfterWarmup: null, coding: null, codingCheck: null,
  conversation: [], unknown: null, formatting: null, samples: sampler.samples,
};

try {
  console.log(`Evaluating ${model} alone; expected digest ${expected.digest.slice(0, 12)}; baseline GPU ${baselineGpu.usedMiB} MiB`);
  results.warmup = await chat([{ role: 'system', content: system }, { role: 'user', content: 'Reply with READY.' }]);
  results.loadedAfterWarmup = await apiJson('/api/ps');
  assert.equal(results.loadedAfterWarmup.models.length, 1, 'Expected exactly one loaded model');
  assert.equal(results.loadedAfterWarmup.models[0].digest, expected.digest, 'Runtime loaded a different digest');
  console.log(`Warmup ${results.warmup.wallMs} ms; runtime digest confirmed`);

  results.coding = await chat([{ role: 'system', content: system }, { role: 'user', content: codingPrompt }]);
  results.codingCheck = await checkCode(results.coding.output, evidenceDir);
  console.log(`Coding ${results.coding.wallMs} ms; TypeScript ${results.codingCheck.typecheck}; checks ${results.codingCheck.testsPassed}/${results.codingCheck.testsTotal}`);

  const messages = [{ role: 'system', content: system }];
  for (let index = 0; index < turns.length; index++) {
    messages.push({ role: 'user', content: turns[index] });
    const answer = await chat(messages);
    results.conversation.push({ turn: index + 1, prompt: turns[index], ...answer });
    messages.push({ role: 'assistant', content: answer.output });
    console.log(`Conversation turn ${index + 1}: ${answer.wallMs} ms`);
  }
  results.unknown = await chat([{ role: 'system', content: system }, { role: 'user', content: unknownPrompt }]);
  results.formatting = await chat([{ role: 'system', content: system }, { role: 'user', content: formatPrompt }]);
  results.formattingExact = results.formatting.output.trim() === '{"status":"ready","count":3,"offline":true}' && !results.formatting.output.trim().includes('\n');
  console.log(`Unknown ${results.unknown.wallMs} ms; strict format ${results.formattingExact}`);
} finally {
  await sampler.stop();
  await execFileAsync('ollama', ['stop', model], { timeout: 15000 });
  results.loadedAfterStop = await apiJson('/api/ps');
  results.tagsAfter = (await apiJson('/api/tags')).models.filter((entry) => entry.name === model).map((entry) => ({ digest: entry.digest, runner: entry.details?.runner }));
  results.showAfterRunner = (await apiJson('/api/show', { model })).details.runner ?? null;
  const outputPath = path.join(evidenceDir, `ollama-final-${model.replace(/[^a-z0-9]+/gi, '-')}.json`);
  await writeFile(outputPath, JSON.stringify(results, null, 2) + '\n', 'utf8');
  console.log(`Saved ${outputPath}; loaded models after stop ${results.loadedAfterStop.models.length}`);
}
