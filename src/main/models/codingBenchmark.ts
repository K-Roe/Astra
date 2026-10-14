/**
 * Model routing and coding-capability measurement.
 *
 * Gemma 3 4B stays the conversational model. `qwen2.5-coder:7b` is a candidate
 * for development work, but whether it is actually usable is a measurement,
 * not an assumption: `benchmarkCodingModel` scores it on concrete tasks and
 * the router refuses to route coding work when reliability is not established.
 */

export type TaskKind = 'conversation' | 'coding' | 'research';

export interface ModelProfile {
  readonly name: string;
  readonly purpose: 'conversation' | 'coding';
  readonly contextTokens: number;
}

export const CONVERSATION_MODEL = 'gemma3:4b';
export const CODING_MODEL = 'qwen2.5-coder:7b';
/** Recorded Intelligence V1 six-case result. Preliminary and never an approval grant. */
export const PRELIMINARY_CODING_RELIABILITY = 5 / 6;

export interface RoutingDecision {
  readonly model: string;
  readonly reason: string;
  /** False when coding work was requested but the coding model is not trusted. */
  readonly permitted: boolean;
}

/**
 * Decide which local model handles a request.
 *
 * Routing is deliberately conservative: if coding reliability has not been
 * measured above `MIN_CODING_RELIABILITY`, coding requests are declined with an
 * explanation rather than silently sent to a model that cannot do them.
 */
export function routeTask(kind: TaskKind, options: { codingReliability?: number } = {}): RoutingDecision {
  const reliability = options.codingReliability ?? 0;

  if (kind === 'conversation') {
    return { model: CONVERSATION_MODEL, reason: 'conversation stays on Gemma 3 4B', permitted: true };
  }
  if (kind === 'research') {
    return { model: CONVERSATION_MODEL, reason: 'research summarisation runs on the conversation model', permitted: true };
  }
  if (reliability < MIN_CODING_RELIABILITY) {
    return {
      model: CODING_MODEL,
      reason: `coding reliability measured at ${reliability.toFixed(2)}, below the ${MIN_CODING_RELIABILITY} threshold; coding work is not delegated`,
      permitted: false,
    };
  }
  return { model: CODING_MODEL, reason: `coding reliability measured at ${reliability.toFixed(2)}`, permitted: true };
}

/** Minimum score before Astra will delegate real code changes to a local model. */
export const MIN_CODING_RELIABILITY = 0.6;

export interface BenchmarkCase {
  readonly id: string;
  readonly skill: string;
  readonly prompt: string;
  /** Objective checks, so a plausible-looking but wrong answer still fails. */
  readonly expect: (output: string) => boolean;
  readonly weight: number;
}

export const BENCHMARK_CASES: readonly BenchmarkCase[] = [
  {
    id: 'ts-type-error',
    skill: 'TypeScript correctness',
    prompt: 'Fix this TypeScript error and reply with only the corrected line:\nconst total: string = 1 + 2;',
    expect: (out) => /const\s+total\s*:\s*(number|string)/.test(out) && !/const\s+total\s*:\s*string\s*=\s*1\s*\+\s*2/.test(out),
    weight: 1,
  },
  {
    id: 'code-generation',
    skill: 'Code generation',
    prompt: 'Write a TypeScript function named slugify that converts a string to lowercase words joined by single hyphens. Reply with code only.',
    expect: (out) => /function\s+slugify/.test(out) && /replace\s*\(/.test(out) && /toLowerCase/.test(out),
    weight: 1,
  },
  {
    id: 'bug-fix',
    skill: 'Bug fixing',
    prompt: 'This function should return the sum but returns a string. Reply with the corrected single line only:\nfunction add(a: number, b: number) { return a + b; }\nconst result = add(1, 2);',
    expect: (out) => /number/.test(out) && /return\s+a\s*\+\s*b/.test(out),
    weight: 1,
  },
  {
    id: 'test-interpretation',
    skill: 'Test interpretation',
    prompt: 'A test fails with "expected 4 but received 5". In one short sentence, what is the most likely cause?',
    expect: (out) => /off\s*by\s*one|logic|increment|count|wrong|bug|miscalculat|expected/i.test(out),
    weight: 1,
  },
  {
    id: 'structured-tool-call',
    skill: 'Structured tool calls',
    prompt: 'Reply with only this JSON object and nothing else: {"tool":"read_file","path":"README.md"}',
    expect: (out) => /"tool"\s*:\s*"read_file"/.test(out) && /"path"\s*:\s*"README\.md"/.test(out),
    weight: 1,
  },
  {
    id: 'multi-file-reasoning',
    skill: 'Multi-file reasoning',
    prompt: 'In a project, src/a.ts exports `add`, and src/b.ts imports `{ add }` from "./a" and calls it. What is the most likely cause if the test fails with "add is not a function"? Reply in one sentence.',
    expect: (out) => /import|export|module|named|default|path|extension/i.test(out),
    weight: 1,
  },
];

export interface BenchmarkCaseResult {
  readonly id: string;
  readonly skill: string;
  readonly passed: boolean;
  readonly output: string;
  readonly durationMs: number;
  readonly error?: string;
}

export interface BenchmarkReport {
  readonly model: string;
  readonly reliability: number;
  readonly passed: number;
  readonly total: number;
  readonly results: readonly BenchmarkCaseResult[];
  readonly bySkill: Readonly<Record<string, { passed: number; total: number }>>;
  readonly usableForCoding: boolean;
  readonly note: string;
}

/** Run the benchmark against a model and produce an evidence-based verdict. */
export function summarizeBenchmark(model: string, results: readonly BenchmarkCaseResult[]): BenchmarkReport {
  const totalWeight = BENCHMARK_CASES.reduce((sum, c) => sum + c.weight, 0);
  const passedWeight = BENCHMARK_CASES.reduce((sum, c) => {
    const result = results.find((r) => r.id === c.id);
    return sum + (result?.passed ? c.weight : 0);
  }, 0);
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const reliability = totalWeight > 0 ? passedWeight / totalWeight : 0;

  const bySkill: Record<string, { passed: number; total: number }> = {};
  for (const result of results) {
    bySkill[result.skill] ??= { passed: 0, total: 0 };
    bySkill[result.skill].total += 1;
    if (result.passed) bySkill[result.skill].passed += 1;
  }

  const usable = reliability >= MIN_CODING_RELIABILITY;
  return {
    model,
    reliability,
    passed,
    total,
    results,
    bySkill,
    usableForCoding: usable,
    note: usable
      ? `Measured reliability ${reliability.toFixed(2)} meets the ${MIN_CODING_RELIABILITY} threshold for delegated coding work.`
      : `Measured reliability ${reliability.toFixed(2)} is below the ${MIN_CODING_RELIABILITY} threshold. Astra must not claim reliable autonomous coding with this model; the limitation is recorded rather than worked around.`,
  };
}
