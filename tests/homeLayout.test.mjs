import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { HOME_ROOM } = require('../dist-electron/shared/homeLayout.js');
const { validateLayout, planPath, isBlocked } = require('../dist-electron/shared/characterNavigation.js');

test('every named home destination is reachable along clear routes', () => {
  assert.deepEqual(validateLayout(HOME_ROOM), []);
  for (const waypoint of HOME_ROOM.waypoints) {
    const route = planPath('centre', waypoint.id, HOME_ROOM);
    assert.ok(route, `unreachable ${waypoint.id}`);
    assert.equal(route.at(-1).id, waypoint.id);
    assert.equal(isBlocked(waypoint.position, HOME_ROOM), false);
  }
});

test('all four home zones and both furniture seats have destinations', () => {
  const ids = new Set(HOME_ROOM.waypoints.map((point) => point.id));
  for (const id of ['living_stand', 'sofa_seat', 'desk_front', 'desk_seat', 'kitchen', 'bedroom_front', 'bedside']) {
    assert.ok(ids.has(id), `missing ${id}`);
  }
});

test('desk chair has a clear side approach and its seated facing points at the monitor', () => {
  const approach = HOME_ROOM.waypoints.find((point) => point.id === 'desk_front');
  const seat = HOME_ROOM.waypoints.find((point) => point.id === 'desk_seat');
  assert(approach && seat);
  assert.ok(approach.position.x < seat.position.x - 0.6);
  assert.ok(Math.abs(approach.position.z - seat.position.z) < 0.2);
  assert.equal(approach.next, 'desk_seat');
  assert.equal(seat.facing, 0, 'negative Z points from chair to monitor');
  assert.equal(planPath('desk_front', 'desk_seat', HOME_ROOM).length, 2);
});
