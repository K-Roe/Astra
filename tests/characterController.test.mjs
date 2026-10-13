import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CharacterController } from '../dist-electron/test/characterController.mjs';
import { DEFAULT_ROOM } from '../dist-electron/shared/characterNavigation.js';

const CLIP_NAMES = [
  'idle_breathing',
  'idle_weight_shift',
  'idle_look_around',
  'walk',
  'turn_left',
  'turn_right',
  'wave',
  'sit_down',
  'seated_idle',
  'stand_up',
  'thinking',
  'listening',
  'talking_gesture',
];

/** Minimal stand-in for the real GLB-backed asset. */
function makeAsset() {
  const object = new THREE.Group();
  const mixer = new THREE.AnimationMixer(object);
  const clips = new Map();
  for (const name of CLIP_NAMES) {
    const track = new THREE.QuaternionKeyframeTrack('.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    clips.set(name, new THREE.AnimationClip(name, 1, [track]));
  }
  return { object, mixer, clips, morphMeshes: [], dispose() {} };
}

/** Drives the controller with a fixed clock so one-shots actually complete. */
function harness({ random = () => 0.5, idleRandom = () => 0.5, walkSpeed = 3, turnSpeed = 12 } = {}) {
  const asset = makeAsset();
  let clock = 0;
  const controller = new CharacterController(asset, {
    random,
    idleRandom,
    walkSpeed,
    turnSpeed,
    now: () => clock,
  });
  const advance = (seconds, step = 1 / 60) => {
    for (let t = 0; t < seconds; t += step) {
      clock += step;
      controller.update(step);
    }
  };
  /** One frame with the clock advancing, so one-shot clips can complete. */
  const tick = (step = 1 / 30) => {
    clock += step;
    controller.update(step);
  };
  return { controller, asset, advance, tick, position: () => controller.getDiagnostics().position, state: () => controller.getState() };
}

/** Queues exact values, then falls back so later draws stay predictable. */
function sequence(values, fallback = 0.5) {
  let i = 0;
  return () => (i < values.length ? values[i++] : fallback);
}

const waypoint = (id) => DEFAULT_ROOM.waypoints.find((w) => w.id === id).position;

test('starting the controller places her on the nearest waypoint', () => {
  const { position } = harness();
  assert.deepEqual(position(), waypoint('centre'));
});

test('a planned journey is not discarded before she starts walking', () => {
  // Regression: entering 'turning' used to clear the freshly planned route, so
  // she sat down at the middle of the room instead of reaching the seat.
  // Draws: pass the hold check, roll 'sit', use the full seat pool, take the
  // nearest seat (sofa_seat).
  const { advance, position, state } = harness({ idleRandom: sequence([0, 0.99, 0.65, 0]) });

  advance(20);
  assert.equal(state(), 'seated', `expected her to be seated, saw ${state()}`);

  const sofa = waypoint('sofa_seat');
  assert.ok(
    Math.hypot(position().x - sofa.x, position().z - sofa.z) < 0.05,
    `she sat at ${JSON.stringify(position())} instead of the sofa at ${JSON.stringify(sofa)}`,
  );
});

test('walking to a destination actually arrives there', () => {
  // Regression: every waypoint with a `next` link used to be followed, so a
  // walk that merely passed the sofa or the desk ended up sitting down.
  const { advance, position, state } = harness({ idleRandom: sequence([0, 0.5, 0.65, 0]) });

  // The scheduler ranks open floor by distance from the centre waypoint, and
  // sofa_front is the closest one.
  const expected = 'sofa_front';
  advance(20);
  const spot = waypoint(expected);
  assert.ok(
    Math.hypot(position().x - spot.x, position().z - spot.z) < 0.05,
    `ended at ${JSON.stringify(position())} not ${expected}`,
  );
  assert.equal(state(), 'interacting');
  assert.ok(position().x !== waypoint('sofa_seat').x, 'she sat down during an ordinary walk');
});

test('disabling idle activities stops her where she stands', () => {
  const { controller, advance, position, state } = harness({ idleRandom: sequence([0, 0.5, 0.65, 0]) });
  advance(20);
  const before = { ...position() };

  controller.setIdleEnabled(false);
  advance(30);
  assert.deepEqual(position(), before, 'she moved while idle activities were off');
  assert.equal(state(), 'idle');
});

test('re-enabling idle activities lets her act again', () => {
  const { controller, advance, position } = harness();
  controller.setIdleEnabled(false);
  advance(20);
  const frozen = { ...position() };
  controller.setIdleEnabled(true);
  advance(30);
  assert.notDeepEqual(position(), frozen, 'she stayed frozen after idle activities were re-enabled');
});

test('waving plays a one-shot clip and returns to idle when the clip ends', () => {
  // Regression: with a constant clock the one-shot never reported completion.
  const { controller, advance, state } = harness();
  controller.wave();
  assert.equal(state(), 'waving');
  advance(2);
  assert.equal(state(), 'idle');
});

test('chat events drive her expression without moving her', () => {
  const { controller, advance, position, state } = harness();
  const before = { ...position() };
  controller.send('chat_typing');
  assert.equal(state(), 'listening');
  controller.send('chat_generating');
  assert.equal(state(), 'thinking');
  advance(3);
  assert.deepEqual(position(), before, 'a chat event moved her');
});

test('she is only ever seated when she is physically at a seat', () => {
  // Sweeps many schedules. Every sitting event must coincide with her standing
  // on that seat's waypoint, and she must never sit at a non-seat.
  const seats = new Set(['desk_seat', 'sofa_seat']);
  let sawSeat = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    let state = seed >>> 0;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const { controller, tick, position } = harness({ random, idleRandom: random, walkSpeed: 2.5, turnSpeed: 9 });
    for (let t = 0; t < 120; t += 1 / 30) {
      tick(1 / 30);
      if (controller.getState() !== 'sitting_down' && controller.getState() !== 'seated') continue;
      const destination = controller.getDiagnostics().destination;
      assert.ok(seats.has(destination), `seed ${seed}: sat with destination ${destination}`);
      const spot = waypoint(destination);
      assert.ok(
        Math.hypot(position().x - spot.x, position().z - spot.z) < 0.05,
        `seed ${seed}: sat at ${JSON.stringify(position())} instead of ${destination} `
          + `(state ${controller.getState()}, clip ${controller.getDiagnostics().clip}, waypoint ${controller.getDiagnostics().waypoint})`,
      );
      sawSeat += 1;
    }
    controller.dispose();
  }
  assert.ok(sawSeat > 0, 'the sweep never observed her sitting down');
});

test('walking never teleports her across the room', () => {
  let state = 99;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const { tick, position } = harness({ random, idleRandom: random, walkSpeed: 1, turnSpeed: 6 });
  let previous = { ...position() };
  for (let t = 0; t < 120; t += 1 / 30) {
    tick(1 / 30);
    const current = position();
    assert.ok(
      Math.hypot(current.x - previous.x, current.z - previous.z) < 0.2,
      `stepped ${Math.hypot(current.x - previous.x, current.z - previous.z).toFixed(2)}m in one frame`,
    );
    previous = { ...current };
  }
});