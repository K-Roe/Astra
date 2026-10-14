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
