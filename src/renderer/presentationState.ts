/** Presentation-only states. Voice states are reserved and cannot be reached by today's chat flow. */
export type PresentationState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export type ChatPhase = 'connecting' | 'ready' | 'generating' | 'error';

export function presentationForChatPhase(phase: ChatPhase): PresentationState {
  if (phase === 'generating') return 'thinking';
  if (phase === 'error') return 'error';
  return 'idle';
}
