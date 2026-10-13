/**
 * Astra's animation state machine.
 *
 * Pure logic with no Three.js, React or DOM dependency so it can be tested
 * directly. The controller owns playback; this module only decides *what*
 * should happen next.
 *
 * Chat events always preempt autonomous activity, because talking to Karl is
 * the highest-priority thing Astra does. Autonomous activity yields to the user
 * rather than fighting for control.
 */

export type CharacterState =
  | 'idle'
  | 'walking'
  | 'turning'
  | 'sitting_down'
  | 'seated'
  | 'standing_up'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'waving'
  | 'interacting';

export type CharacterEvent =
  | 'chat_typing'
  | 'chat_generating'
  | 'chat_reply'
  | 'chat_error'
  | 'chat_interrupted'
  | 'user_wave'
  | 'user_center'
  | 'go_to'
  | 'go_to_seat'
  | 'activity'
  | 'arrive'
  | 'sit_start'
  | 'turn_done'
  | 'sit_done'
  | 'stand_done'
  | 'clip_finished'
  | 'leave_seat';

/**
 * A queued character event. The nonce guarantees that repeated identical
 * events still reach the scene, because React compares object identity.
 */
export interface CharacterSignal {
  readonly event: CharacterEvent;
  readonly nonce: number;
}

/** States the chat lifecycle may preempt from any state. */
const CHAT_DRIVEN: readonly CharacterState[] = ['listening', 'thinking', 'speaking'];

export function isChatDriven(state: CharacterState): boolean {
  return CHAT_DRIVEN.includes(state);
}

/** Autonomous states the idle scheduler is allowed to start. */
const AUTONOMOUS_STATES: readonly CharacterState[] = [
  'idle',
  'walking',
  'turning',
  'sitting_down',
  'seated',
  'standing_up',
  'interacting',
];

export function isAutonomous(state: CharacterState): boolean {
  return AUTONOMOUS_STATES.includes(state);
}

/**
 * Decide the next state. Returns the same state when an event does not apply,
 * which keeps transitions total and makes "stuck" states impossible to reach by
 * feeding unexpected events.
 */
export function nextState(current: CharacterState, event: CharacterEvent): CharacterState {
  // Chat always wins, from any state, including mid-transition.
  switch (event) {
    case 'chat_typing':
      return current === 'seated' ? 'seated' : 'listening';
    case 'chat_generating':
      return current === 'seated' ? 'seated' : 'thinking';
    case 'chat_reply':
      return current === 'seated' ? 'seated' : 'speaking';
    case 'chat_error':
      return current === 'seated' ? 'seated' : 'thinking';
    case 'chat_interrupted':
      return current === 'seated' ? 'seated' : 'idle';
    case 'user_wave':
      return current === 'seated' ? 'seated' : 'waving';
    default:
      break;
  }

  switch (current) {
    case 'idle':
      switch (event) {
        case 'user_center':
        case 'go_to':
          return 'turning';
        case 'go_to_seat':
        case 'activity':
          return 'turning';
        default:
          return 'idle';
      }
    case 'turning':
      return event === 'turn_done' ? 'walking' : 'turning';
    case 'walking':
      if (event === 'sit_start') return 'sitting_down';
      if (event === 'arrive') return 'idle';
      if (event === 'activity') return 'interacting';
      return 'walking';
    case 'sitting_down':
      return event === 'sit_done' ? 'seated' : 'sitting_down';
    case 'seated':
      if (event === 'leave_seat') return 'standing_up';
      if (event === 'activity') return 'seated';
      return 'seated';
    case 'standing_up':
      return event === 'stand_done' ? 'idle' : 'standing_up';
    case 'interacting':
      return event === 'clip_finished' ? 'idle' : 'interacting';
    case 'waving':
      return event === 'clip_finished' ? 'idle' : 'waving';
    case 'listening':
    case 'thinking':
    case 'speaking':
      return event === 'clip_finished' ? 'idle' : current;
    default:
      return 'idle';
  }
}

/**
 * Follow a chain of events to a settled state. Used by tests and by the
 * controller when it needs to resolve a burst of events at once.
 */
export function applyEvents(state: CharacterState, events: readonly CharacterEvent[]): CharacterState {
  return events.reduce(nextState, state);
}

/** True when the state should hold its looping clip until another event. */
export function stateHoldsClip(state: CharacterState): boolean {
  return state !== 'turning' && state !== 'walking' && state !== 'sitting_down' && state !== 'standing_up';
}