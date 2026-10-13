import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  DEFAULT_ROOM,
  angleDelta,
  buildGraph,
  distance,
  isBlocked,
  nearestWaypoint,
  planPath,
  validateLayout,
  waypointById,
} = require('../dist-electron/shared/characterNavigation.js');

test('the room layout is valid: no waypoint or edge crosses furniture', () => {
  assert.deepEqual(validateLayout(DEFAULT_ROOM), []);
});

test('furniture footprints are treated as blocked', () => {
  assert.equal(isBlocked({ x: 1.2, z: -1.8 }, DEFAULT_ROOM), true, 'inside the desk');
  assert.equal(isBlocked({ x: 2.2, z: 0.2 }, DEFAULT_ROOM), true, 'inside the sofa');
  assert.equal(isBlocked({ x: -2.1, z: -1.5 }, DEFAULT_ROOM), true, 'inside the shelf');
  assert.equal(isBlocked({ x: 0.1, z: 0.7 }, DEFAULT_ROOM), false, 'open floor at the centre');
  assert.equal(isBlocked({ x: 9, z: 0 }, DEFAULT_ROOM), true, 'outside the room bounds');
});

test('a path exists from the centre to every reachable destination', () => {
  for (const waypoint of DEFAULT_ROOM.waypoints) {
    const path = planPath('centre', waypoint.id, DEFAULT_ROOM);
    assert.ok(path, `no path to ${waypoint.id}`);
    assert.equal(path.at(-1).id, waypoint.id);
    assert.equal(path[0].id, 'centre');
  }
});

test('paths are contiguous: consecutive waypoints are always connected', () => {
  const graph = buildGraph(DEFAULT_ROOM);
  const path = planPath('centre', 'desk_seat', DEFAULT_ROOM);
  assert.ok(path);
  for (let index = 1; index < path.length; index += 1) {
    const neighbours = graph.get(path[index - 1].id) ?? [];
    assert.ok(neighbours.includes(path[index].id), `${path[index - 1].id} not linked to ${path[index].id}`);
  }
});

test('paths avoid walking through furniture', () => {
  for (const goal of DEFAULT_ROOM.waypoints) {
    const path = planPath('centre', goal.id, DEFAULT_ROOM);
    assert.ok(path);
    for (let index = 1; index < path.length; index += 1) {
      const from = path[index - 1].position;
      const to = path[index].position;
      const midpoint = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
      assert.equal(isBlocked(midpoint, DEFAULT_ROOM, 0.05), false, `${goal.id} path crosses furniture at ${JSON.stringify(midpoint)}`);
    }
  }
});

test('unknown destinations are refused rather than silently ignored', () => {
  assert.equal(planPath('centre', 'nowhere', DEFAULT_ROOM), null);
  assert.equal(planPath('nowhere', 'centre', DEFAULT_ROOM), null);
});

test('nearest waypoint always returns a real, walkable node', () => {
  const near = nearestWaypoint({ x: 0.2, z: 0.7 }, DEFAULT_ROOM);
  assert.equal(near.id, 'centre');
  assert.equal(isBlocked(near.position, DEFAULT_ROOM), false);
});

test('heading maths wraps correctly for turning', () => {
  assert.ok(Math.abs(angleDelta(0, Math.PI / 2) - Math.PI / 2) < 1e-9);
  // 1.9*PI and -1.9*PI are 0.2*PI apart once wrapped, not 3.8*PI.
  assert.ok(Math.abs(angleDelta(Math.PI * 1.9, -Math.PI * 1.9) - Math.PI * 0.2) < 1e-9);
  assert.equal(angleDelta(1, 1), 0);
});

test('distance is euclidean on the floor plane', () => {
  assert.equal(distance({ x: 0, z: 0 }, { x: 3, z: 4 }), 5);
});

test('waypoint lookup by id is stable', () => {
  assert.equal(waypointById('centre', DEFAULT_ROOM).id, 'centre');
  assert.equal(waypointById('missing', DEFAULT_ROOM), undefined);
});