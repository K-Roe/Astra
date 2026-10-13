export interface WorldFrameSample {
  readonly timeMs: number;
  readonly intervalMs: number | null;
  readonly renderCpuMs: number;
  readonly source: 'idle' | 'resize';
  readonly drawCalls: number;
  readonly triangles: number;
}

export interface WorldFrameSummary {
  readonly frames: number;
  readonly averageFps: number | null;
  readonly averageIntervalMs: number | null;
  readonly p95IntervalMs: number | null;
  readonly averageRenderCpuMs: number | null;
  readonly p95RenderCpuMs: number | null;
  readonly drawCalls: number | null;
  readonly triangles: number | null;
}

function percentile95(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

export function summarizeWorldFrames(samples: readonly WorldFrameSample[]): WorldFrameSummary {
  const frames = samples.filter((sample) => sample.source === 'idle' && sample.intervalMs !== null && sample.intervalMs > 0);
  if (frames.length === 0) {
    return { frames: 0, averageFps: null, averageIntervalMs: null, p95IntervalMs: null, averageRenderCpuMs: null, p95RenderCpuMs: null, drawCalls: null, triangles: null };
  }
  const intervals = frames.map((frame) => frame.intervalMs as number);
  const renderCosts = frames.map((frame) => frame.renderCpuMs);
  const averageIntervalMs = intervals.reduce((sum, value) => sum + value, 0) / frames.length;
  return {
    frames: frames.length,
    averageFps: 1000 / averageIntervalMs,
    averageIntervalMs,
    p95IntervalMs: percentile95(intervals),
    averageRenderCpuMs: renderCosts.reduce((sum, value) => sum + value, 0) / frames.length,
    p95RenderCpuMs: percentile95(renderCosts),
    drawCalls: frames.at(-1)?.drawCalls ?? null,
    triangles: frames.at(-1)?.triangles ?? null,
  };
}
