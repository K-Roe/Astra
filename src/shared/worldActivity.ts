/** Read-only presentation of real application work. No authority flows back. */
export type WorldActivity = 'idle' | 'awaiting_approval' | 'learning' | 'coding';

/** Active approved work outranks learning; a pending plan never looks busy. */
export function worldActivityFor(codingPhase: string | null, learningRunning: boolean): WorldActivity {
  if (codingPhase === 'implementing' || codingPhase === 'testing' || codingPhase === 'reviewing') return 'coding';
  if (learningRunning) return 'learning';
  if (codingPhase === 'awaiting_approval') return 'awaiting_approval';
  return 'idle';
}
