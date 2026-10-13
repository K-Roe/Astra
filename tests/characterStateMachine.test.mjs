import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  CHARACTER_CLIPS,
  CHARACTER_MORPHS,
  LOOPING_CLIPS,
  ONE_SHOT_CLIPS,
  STATE_CLIP,
  STATE_EXPRESSION,
} = require('../dist-electron/shared/characterClips.js');
const {
  applyEvents,
  isAutonomous,
  isChatDriven,
  nextState,
  stateHoldsClip,
} = require('../dist-electron/shared/characterStateMachine.js');

test('every animation state has a clip and an expression', () => {
  const states = ['idle', 'walking', 'turning', 'sitting_down', 'seated', 'standing_up', 'listening', 'thinking', 'speaking', 'waving', 'interacting'];
  for (const state of states) {
    assert.ok(CHARACTER_CLIPS.includes(STATE_CLIP[state]), `${state} has no clip`);
    assert.ok(CHARACTER_MORPHS.includes(STATE_EXPRESSION[state]), `${state} has no expression`);
  }
});

test('clip loops and one-shots partition the animation library', () => {
  for (const clip of CHARACTER_CLIPS) {
    assert.ok(LOOPING_CLIPS.has(clip) || ONE_SHOT_CLIPS.has(clip), `${clip} is neither looping nor one-shot`);
    assert.ok(!(LOOPING_CLIPS.has(clip) && ONE_SHOT_CLIPS.has(clip)), `${clip} is in both sets`);
  }
});

test('chat events preempt autonomous activity from every state', () => {
  const states = ['idle', 'walking', 'turning', 'sitting_down', 'seated', 'standing_up', 'interacting', 'waving', 'speaking'];
  for (const state of states) {
    assert.equal(nextState(state, 'chat_generating'), state === 'seated' ? 'seated' : 'thinking');
    assert.equal(nextState(state, 'chat_reply'), state === 'seated' ? 'seated' : 'speaking');
    assert.equal(nextState(state, 'chat_typing'), state === 'seated' ? 'seated' : 'listening');
  }
});

test('seated keeps her seated while chatting instead of standing up', () => {
  assert.equal(nextState('seated', 'chat_reply'), 'seated');
  assert.equal(applyEvents('seated', ['chat_typing', 'chat_generating', 'chat_reply', 'clip_finished']), 'seated');
});

test('walking reaches idle by arriving, and never skips a stage', () => {
  assert.equal(nextState('idle', 'go_to'), 'turning');
  assert.equal(nextState('turning', 'turn_done'), 'walking');
  assert.equal(nextState('walking', 'arrive'), 'idle');
  // Waiting in walking must not fall back to idle on its own.
  assert.equal(nextState('walking', 'clip_finished'), 'walking');
});

test('sitting and standing complete deterministically', () => {
  assert.equal(nextState('idle', 'go_to_seat'), 'turning');
  assert.equal(nextState('turning', 'turn_done'), 'walking');
  assert.equal(nextState('walking', 'sit_start'), 'sitting_down');
  assert.equal(applyEvents('idle', ['go_to_seat', 'turn_done', 'sit_start', 'sit_done']), 'seated');
  assert.equal(nextState('walking', 'activity'), 'interacting');
  assert.equal(nextState('idle', 'leave_seat'), 'idle');
  assert.equal(nextState('seated', 'leave_seat'), 'standing_up');
  assert.equal(nextState('standing_up', 'stand_done'), 'idle');
  assert.equal(nextState('sitting_down', 'sit_done'), 'seated');
});

test('one-shot states return to idle and cannot become permanently stuck', () => {
  assert.equal(nextState('waving', 'clip_finished'), 'idle');
  assert.equal(nextState('interacting', 'clip_finished'), 'idle');
  assert.equal(nextState('speaking', 'clip_finished'), 'idle');
  // Repeated irrelevant events must never change a settled state.
  let state = 'idle';
  for (let i = 0; i < 25; i += 1) state = nextState(state, 'turn_done');
  assert.equal(state, 'idle');
});

test('state classification and clip holding match the documented contract', () => {
  assert.equal(isChatDriven('thinking'), true);
  assert.equal(isChatDriven('walking'), false);
  assert.equal(isAutonomous('walking'), true);
  assert.equal(isAutonomous('speaking'), false);
  assert.equal(stateHoldsClip('idle'), true);
  assert.equal(stateHoldsClip('walking'), false);
  assert.equal(stateHoldsClip('sitting_down'), false);
});

test('chat interruption always yields control back to idle', () => {
  assert.equal(nextState('thinking', 'chat_interrupted'), 'idle');
  assert.equal(nextState('speaking', 'chat_interrupted'), 'idle');
  assert.equal(applyEvents('idle', ['chat_typing', 'chat_interrupted']), 'idle');
});