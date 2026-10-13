/**
 * Runs the coding benchmark against a locally installed Ollama model and
 * writes the evidence to test-results. Measurement, not assertion: the report
 * records whatever the model actually scores.
 *
 * Usage: node scripts/benchmark-coding-model.mjs [model]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BENCHMARK_CASES, summarizeBenchmark, CODING_MODEL, CONVERSATION_MODEL } = require('../dist-electron/main/models/codingBenchmark.js');

const OLLAMA = 'http://127.0.0.1:11434';
const model = process.argv[2] ?? CODING_MODEL;

async function availableModels() {
  const response = await fetch(`${OLLAMA}/api/tags`).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json()).models?.map((m) => m.name) ?? [];
}

async function ask(prompt, timeoutMs = 120_000) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0, num_predict: 400 } }),
      signal: controller.signal,
    });
    if (!response.ok) return { output: '', durationMs: Date.now() - started, error: `http-${response.status}` };
    const body = await response.json();
    return { output: String(body.response ?? ''), durationMs: Date.now() - started };
  } catch (error) {
    return { output: '', durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

const installed = await availableModels();
if (installed === null) {
  console.error('Ollama is not reachable at 127.0.0.1:11434; benchmark not run.');
  process.exit(2);
}
if (!installed.some((n) => n === model || n.split(':')[0] === model.split(':')[0])) {
  console.error(`Model ${model} is not installed. Available: ${installed.join(', ') || 'none'}`);
  process.exit(2);
}

console.log(`Benchmarking ${model} on ${BENCHMARK_CASES.length} cases...`);
const results = [];
for (const testCase of BENCHMARK_CASES) {
  const { output, durationMs, error } = await ask(testCase.prompt);
  let passed = false;
  if (!error) {
    try {
      passed = testCase.expect(output);
    } catch {
      passed = false;
    }
  }
  results.push({ id: testCase.id, skill: testCase.skill, passed, output: output.slice(0, 400), durationMs, ...(error ? { error } : {}) });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${testCase.id.padEnd(24)} ${testCase.skill} (${durationMs} ms)`);
}

const report = {
  ...summarizeBenchmark(model, results),
  conversationModel: CONVERSATION_MODEL,
  ranAt: new Date().toISOString(),
  // Recorded so a good score is not over-read.
  scope: 'Six short, single-shot, deterministic prompts with objective pass/fail checks. ' +
    'This measures whether the model can handle small well-specified tasks. It does NOT establish ' +
    'reliable unattended multi-step development on a real repository, so delegated coding work stays ' +
    'bounded: every change still needs Karl\'s approval, every edit is verified by running tests, ' +
    'and nothing is committed or pushed without a separate approval.',
};
mkdirSync('test-results/intelligence', { recursive: true });
writeFileSync('test-results/intelligence/coding-model-benchmark.json', JSON.stringify(report, null, 2), 'utf8');

console.log(`\nreliability ${report.reliability.toFixed(2)} (${report.passed}/${report.total})`);
console.log(`usable for delegated coding: ${report.usableForCoding}`);
console.log(report.note);
console.log('written to test-results/intelligence/coding-model-benchmark.json');