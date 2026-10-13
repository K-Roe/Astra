/** Small shapes the workspaces need, kept local to the renderer layer. */

export interface KnowledgeStats {
  readonly sources: number;
  readonly documents: number;
  readonly chunks: number;
  readonly bytes: number;
}

export interface MemoryView {
  readonly id: number;
  readonly statement: string;
  readonly category: string;
  readonly confidence: number;
  readonly active: boolean;
}

export interface ApprovalView {
  readonly id: number;
  readonly action: string;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly risk: string;
  readonly status: string;
}

export interface AuditView {
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly result: string;
}

export interface CodingBenchmarkView {
  readonly model: string;
  readonly reliability: number;
  readonly usableForCoding: boolean;
  readonly note: string;
}