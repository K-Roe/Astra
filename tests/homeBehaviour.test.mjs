import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createRequire } from 'node:module';
import { CharacterController } from '../dist-electron/test/characterController.mjs';

const require = createRequire(import.meta.url);
const { HOME_ROOM } = require('../dist-electron/shared/homeLayout.js');
const { worldActivityFor } = require('../dist-electron/shared/worldActivity.js');

function character(idleRandom = () => 0.5) {
  const object = new THREE.Group();
  const mixer = new THREE.AnimationMixer(object);
  const clips = new Map();
  for (const name of ['idle_breathing', 'walk', 'turn_left', 'turn_right', 'sit_down', 'seated_idle', 'stand_up', 'desk_work', 'thinking', 'wave']) {
    clips.set(name, new THREE.AnimationClip(name, 0.5, [new THREE.QuaternionKeyframeTrack('.quaternion', [0, 0.5], [0, 0, 0, 1, 0, 0, 0, 1])]));
  }
  let now = 0;
  const controller = new CharacterController({ object, mixer, clips, morphMeshes: [], dispose() {} }, {
    layout: HOME_ROOM, walkSpeed: 2.5, turnSpeed: 10, now: () => now, random: () => 0.5, idleRandom,
  });
  const advance = (seconds) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 30) {
      now += 1 / 30;
      controller.update(1 / 30);
    }
  };
  return { controller, advance, object };
}

test('only real active work maps to desk-work presentation', () => {
  assert.equal(worldActivityFor('investigating', false), 'planning');
  assert.equal(worldActivityFor('planning', false), 'planning');
  assert.equal(worldActivityFor('awaiting_approval', false), 'awaiting_approval');
  assert.equal(worldActivityFor('implementing', false), 'coding');
  assert.equal(worldActivityFor('testing', false), 'coding');
  assert.equal(worldActivityFor('completed', false), 'idle');
  assert.equal(worldActivityFor(null, true), 'learning');
  assert.equal(worldActivityFor('testing', true), 'coding');
});

test('planning walks to the desk, approval waits without typing, and approved work resumes', () => {
  const { controller, advance } = character();
  controller.setActivity('planning');
  advance(8);
  assert.equal(controller.getDiagnostics().waypoint, 'desk_seat');
  assert.equal(controller.getDiagnostics().clip, 'desk_work');
  controller.setActivity('awaiting_approval');
  advance(1);
  assert.equal(controller.getDiagnostics().state, 'seated');
  assert.equal(controller.getDiagnostics().clip, 'seated_idle');
  controller.setActivity('coding');
  advance(0.2);
  assert.equal(controller.getDiagnostics().clip, 'desk_work');
  controller.setActivity('idle');
  assert.equal(controller.getDiagnostics().clip, 'seated_idle');
  controller.dispose();
});

test('approval arriving or cancellation during the walk does not teleport', () => {
  const { controller, advance } = character();
  controller.setActivity('planning');
  advance(0.5);
  const before = controller.getDiagnostics().position;
  controller.setActivity('awaiting_approval');
  advance(0.5);
  const waiting = controller.getDiagnostics().position;
  assert.ok(Math.hypot(waiting.x - before.x, waiting.z - before.z) < 1.5);
  controller.setActivity('coding');
  advance(0.5);
  controller.setActivity('idle');
  const cancelled = controller.getDiagnostics().position;
  advance(0.1);
  const after = controller.getDiagnostics().position;
  assert.ok(Math.hypot(after.x - cancelled.x, after.z - cancelled.z) < 0.3);
  assert.notEqual(controller.getDiagnostics().clip, 'desk_work');
  controller.dispose();
});

test('active coding walks the single character to the desk and survives chat acknowledgement', () => {
  const { controller, advance, object } = character();
  controller.setActivity('coding');
  advance(8);
  const atDesk = controller.getDiagnostics();
  assert.equal(atDesk.state, 'seated', JSON.stringify(atDesk));
  assert.equal(atDesk.waypoint, 'desk_seat');
  assert.equal(atDesk.activity, 'coding');
  assert.equal(atDesk.clip, 'desk_work');
  assert.ok(Math.abs(object.rotation.y - Math.PI) < 0.01, 'rig faces the monitor while working');
  controller.returnToCentre();
  advance(0.3);
  assert.equal(controller.getDiagnostics().waypoint, 'desk_seat', 'manual centre cannot interrupt approved work');
  controller.send('chat_reply');
  advance(1);
  assert.equal(controller.getDiagnostics().state, 'seated');
  controller.setActivity('awaiting_approval');
  assert.equal(controller.getDiagnostics().clip, 'seated_idle');
  controller.dispose();
});


test('interrupted work stops the route without teleporting', () => {
  const { controller, advance } = character();
  controller.setActivity('learning');
  advance(0.5);
  const before = controller.getDiagnostics().position;
  controller.setActivity('idle');
  advance(0.2);
  const after = controller.getDiagnostics().position;
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < 0.25);
  assert.equal(controller.getDiagnostics().activity, 'idle');
  controller.dispose();
});

test('Centre UI event uses the navigable path when no task is running', () => {
  const { controller, advance } = character();
  controller.setActivity('learning');
  advance(8);
  controller.setActivity('idle');
  controller.send('user_center');
  assert.equal(controller.getDiagnostics().state, 'standing_up');
  advance(8);
  assert.equal(controller.getDiagnostics().waypoint, 'centre');
  controller.dispose();
});

test('desk work stands Astra up from the sofa before taking a clear route', () => {
  const values = [0, 0.99, 0.65, 0];
  const { controller, advance } = character(() => values.shift() ?? 0.5);
  advance(17);
  assert.equal(controller.getDiagnostics().waypoint, 'sofa_seat');
  assert.equal(controller.getDiagnostics().state, 'seated');
  controller.setActivity('learning');
  assert.equal(controller.getDiagnostics().state, 'standing_up');
  advance(8);
  const atDesk = controller.getDiagnostics();
  assert.equal(atDesk.waypoint, 'desk_seat', JSON.stringify(atDesk));
  assert.equal(atDesk.state, 'seated');
  controller.dispose();
});
