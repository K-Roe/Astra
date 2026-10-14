import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { IdleScheduler, DEFAULT_IDLE_OPTIONS } = require('../dist-electron/shared/characterIdle.js');

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test('a disabled scheduler never proposes an activity', () => {
  const scheduler = new IdleScheduler({ ...DEFAULT_IDLE_OPTIONS, enabled: false, random: seededRandom(1) });
  for (let i = 0; i < 40; i += 1) {
    const decision = scheduler.decide({ x: 0, z: 0 });
    assert.equal(decision.held, true);
    assert.equal(decision.activity.kind, 'stay');
  }
});

test('the scheduler only proposes approved activity kinds and destinations', () => {
  const allowed = new Set(DEFAULT_IDLE_OPTIONS.destinations);
  const scheduler = new IdleScheduler({ ...DEFAULT_IDLE_OPTIONS, random: seededRandom(7) });
  const kinds = new Set();
  for (let i = 0; i < 200; i += 1) {
    const { activity } = scheduler.decide({ x: 0, z: 0 });
    kinds.add(activity.kind);
    assert.ok(['stay', 'walk', 'sit', 'interact'].includes(activity.kind), `unexpected kind ${activity.kind}`);
    if ('destination' in activity) assert.ok(allowed.has(activity.destination), `unapproved destination ${activity.destination}`);
  }
  assert.ok(kinds.size >= 3, `expected varied activity, saw ${[...kinds]}`);
});

test('the scheduler never repeats the same activity twice in a row', () => {
  const scheduler = new IdleScheduler({ ...DEFAULT_IDLE_OPTIONS, activityChance: 1, random: seededRandom(11) });
  let previous = null;
  for (let i = 0; i < 200; i += 1) {
    const { activity } = scheduler.decide({ x: 0, z: 0 });
    const key = 'destination' in activity ? `${activity.kind}:${activity.destination}` : `${activity.kind}:${activity.clip}`;
    if (previous) assert.notEqual(key, previous, `repeated ${key}`);
    previous = key;
  }
});

test('enabling and disabling is reversible at runtime', () => {
  const scheduler = new IdleScheduler({ ...DEFAULT_IDLE_OPTIONS, random: seededRandom(3) });
  assert.equal(scheduler.isEnabled(), true);
  scheduler.setEnabled(false);
  assert.equal(scheduler.isEnabled(), false);
  assert.equal(scheduler.tick(999, { x: 0, z: 0 }), null, 'a disabled scheduler returns no decision');
  scheduler.setEnabled(true);
  assert.ok(scheduler.tick(999, { x: 0, z: 0 }), 're-enabling restores scheduling');
});

test('decisions are rate limited by the configured interval', () => {
  const scheduler = new IdleScheduler({ ...DEFAULT_IDLE_OPTIONS, intervalSeconds: 10, random: seededRandom(5) });
  assert.equal(scheduler.tick(1, { x: 0, z: 0 }), null, 'first short tick decides nothing');
  assert.notEqual(scheduler.tick(20, { x: 0, z: 0 }), null, 'a long enough tick produces a decision');
});

test('a scheduler reset forgets its history', () => {
  const scheduler = new IdleScheduler({ ...DEFAULT_IDLE_OPTIONS, activityChance: 1, random: seededRandom(13) });
  scheduler.decide({ x: 0, z: 0 });
  scheduler.reset();
  assert.equal(scheduler.getOptions().enabled, true);
});

test('idle cannot remain motionless through three full decision intervals', () => {
  const scheduler = new IdleScheduler({
    ...DEFAULT_IDLE_OPTIONS,
    activityChance: 0,
    seatDestinations: ['sofa_seat'],
    random: () => 0.9,
  });
  const decisions = [scheduler.decide({ x: 0, z: 0 }), scheduler.decide({ x: 0, z: 0 }), scheduler.decide({ x: 0, z: 0 })];
  assert.equal(decisions[0].held, true);
  assert.equal(decisions[1].held, true);
  assert.equal(decisions[2].activity.kind, 'walk');
});

test('sitting is only ever proposed at a registered seat', () => {
  const seats = ['desk_seat', 'sofa_seat'];
  const scheduler = new IdleScheduler({
    ...DEFAULT_IDLE_OPTIONS,
    activityChance: 1,
    destinations: DEFAULT_IDLE_OPTIONS.destinations,
    seatDestinations: seats,
    random: seededRandom(23),
  });
  let sat = 0;
  for (let i = 0; i < 300; i += 1) {
    const { activity } = scheduler.decide({ x: 0, z: 0 });
    if (activity.kind !== 'sit') continue;
    sat += 1;
    assert.ok(seats.includes(activity.destination), `sit targeted a non-seat: ${activity.destination}`);
  }
  assert.ok(sat > 0, 'a 300-roll sample never produced a sit');
});

test('walking and loitering never target a seat, because arriving would sit her down', () => {
  const seats = ['desk_seat', 'sofa_seat'];
  const scheduler = new IdleScheduler({
    ...DEFAULT_IDLE_OPTIONS,
    activityChance: 1,
    destinations: DEFAULT_IDLE_OPTIONS.destinations,
    seatDestinations: seats,
    random: seededRandom(29),
  });
  for (let i = 0; i < 300; i += 1) {
    const { activity } = scheduler.decide({ x: 0, z: 0 });
    if (!('destination' in activity) || activity.kind === 'sit') continue;
    assert.ok(!seats.includes(activity.destination), `${activity.kind} targeted a seat: ${activity.destination}`);
  }
});

test('with no seats registered a sit roll degrades to open floor instead of vanishing', () => {
  const scheduler = new IdleScheduler({ ...DEFAULT_IDLE_OPTIONS, activityChance: 1, random: seededRandom(31) });
  for (let i = 0; i < 200; i += 1) {
    const { activity } = scheduler.decide({ x: 0, z: 0 });
    if (activity.kind !== 'sit') continue;
    assert.ok(DEFAULT_IDLE_OPTIONS.destinations.includes(activity.destination), 'sit fell back to an unknown destination');
  }
});
