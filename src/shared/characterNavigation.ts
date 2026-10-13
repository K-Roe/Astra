/**
 * Deterministic room navigation for Astra.
 *
 * A small explicit waypoint graph rather than a general navigation mesh: the
 * room has a handful of places worth visiting, and an explicit graph guarantees
 * she can never walk through furniture or into a wall. Pure maths, no Three.js,
 * so it is directly testable.
 *
 * Headings use the convention heading(f) = (sin f, 0, -cos f), so f = 0 looks
 * toward -Z (into the room) and f = PI looks toward +Z (at the user).
 */

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export interface Obstacle {
  readonly name: string;
  /** Axis-aligned footprint on the floor plane. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface Waypoint {
  readonly id: string;
  readonly position: Vec2;
  readonly facing: number;
  /** Where to continue once she arrives, for one-way furniture approaches. */
  readonly next?: string;
}

export interface RoomLayout {
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  readonly obstacles: readonly Obstacle[];
  readonly waypoints: readonly Waypoint[];
  readonly edges: readonly (readonly [string, string])[];
}

/** Character body radius, used as the clearance margin around obstacles. */
export const CHARACTER_RADIUS = 0.22;

export const DEFAULT_ROOM: RoomLayout = {
  bounds: { minX: -2.6, maxX: 2.6, minZ: -2.0, maxZ: 2.0 },
  obstacles: [
    { name: 'back wall', minX: -3.2, maxX: 3.2, minZ: -2.6, maxZ: -2.05 },
    { name: 'side wall', minX: -3.2, maxX: -2.75, minZ: -2.6, maxZ: 2.4 },
    { name: 'desk', minX: 0.5, maxX: 1.9, minZ: -2.05, maxZ: -1.6 },
    { name: 'sofa', minX: 1.95, maxX: 2.55, minZ: -0.55, maxZ: 0.95 },
    { name: 'shelf', minX: -2.55, maxX: -1.75, minZ: -1.9, maxZ: -1.15 },
  ],
  waypoints: [
    { id: 'centre', position: { x: 0.1, z: 0.7 }, facing: Math.PI },
    { id: 'front_left', position: { x: -1.3, z: 1.4 }, facing: Math.PI },
    { id: 'front_right', position: { x: 1.1, z: 1.4 }, facing: Math.PI },
    { id: 'middle_left', position: { x: -1.2, z: 0.1 }, facing: Math.PI },
    { id: 'middle_right', position: { x: 1.2, z: 0.1 }, facing: Math.PI },
    { id: 'desk_front', position: { x: 1.2, z: -0.85 }, facing: 0, next: 'desk_seat' },
    { id: 'desk_seat', position: { x: 1.2, z: -1.25 }, facing: 0 },
    { id: 'sofa_front', position: { x: 1.15, z: 0.9 }, facing: Math.PI / 2, next: 'sofa_seat' },
    { id: 'sofa_seat', position: { x: 1.6, z: 0.2 }, facing: -Math.PI / 2 },
    { id: 'shelf_front', position: { x: -2.05, z: -0.7 }, facing: 0 },
  ],
  edges: [
    ['centre', 'front_left'],
    ['centre', 'front_right'],
    ['centre', 'middle_left'],
    ['centre', 'middle_right'],
    ['centre', 'desk_front'],
    ['centre', 'sofa_front'],
    ['front_left', 'front_right'],
    ['front_left', 'middle_left'],
    ['front_right', 'middle_right'],
    ['front_right', 'sofa_front'],
    ['middle_left', 'shelf_front'],
    ['middle_right', 'desk_front'],
    ['desk_front', 'desk_seat'],
    ['sofa_front', 'sofa_seat'],
  ],
};

/** Waypoints that represent sitting positions rather than walking targets. */
export const SEAT_WAYPOINTS: readonly string[] = ['desk_seat', 'sofa_seat'];

/** Shortest signed angle from one heading to another, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function pointInObstacle(point: Vec2, obstacle: Obstacle, margin: number): boolean {
  return (
    point.x > obstacle.minX - margin &&
    point.x < obstacle.maxX + margin &&
    point.z > obstacle.minZ - margin &&
    point.z < obstacle.maxZ + margin
  );
}

export function isBlocked(point: Vec2, layout: RoomLayout, margin = CHARACTER_RADIUS): boolean {
  if (point.x < layout.bounds.minX || point.x > layout.bounds.maxX) return true;
  if (point.z < layout.bounds.minZ || point.z > layout.bounds.maxZ) return true;
  return layout.obstacles.some((obstacle) => pointInObstacle(point, obstacle, margin));
}

/** Liang-Barsky segment versus expanded rectangle test. */
function segmentBlocked(a: Vec2, b: Vec2, layout: RoomLayout, margin: number): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const obstacle of layout.obstacles) {
    const minX = obstacle.minX - margin;
    const maxX = obstacle.maxX + margin;
    const minZ = obstacle.minZ - margin;
    const maxZ = obstacle.maxZ + margin;
    let t0 = 0;
    let t1 = 1;
    let rejected = false;
    const checks: [number, number][] = [
      [-dx, a.x - minX],
      [dx, maxX - a.x],
      [-dz, a.z - minZ],
      [dz, maxZ - a.z],
    ];
    for (const [p, q] of checks) {
      if (p === 0) {
        if (q < 0) rejected = true;
        continue;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) rejected = true;
        else if (r > t0) t0 = r;
      } else {
        if (r < t0) rejected = true;
        else if (r < t1) t1 = r;
      }
    }
    if (!rejected && t0 <= t1) return true;
  }
  return false;
}

/** Nearest waypoint to a world position, used to start a path from anywhere. */
export function nearestWaypoint(point: Vec2, layout: RoomLayout): Waypoint {
  let best = layout.waypoints[0];
  let bestDistance = distance(point, best.position);
  for (const waypoint of layout.waypoints) {
    const candidate = distance(point, waypoint.position);
    if (candidate < bestDistance) {
      best = waypoint;
      bestDistance = candidate;
    }
  }
  return best;
}

export function waypointById(id: string, layout: RoomLayout): Waypoint | undefined {
  return layout.waypoints.find((waypoint) => waypoint.id === id);
}

/** Undirected adjacency built from the edge list. */
export function buildGraph(layout: RoomLayout): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const waypoint of layout.waypoints) graph.set(waypoint.id, []);
  for (const [from, to] of layout.edges) {
    graph.get(from)?.push(to);
    graph.get(to)?.push(from);
  }
  return graph;
}

/** Breadth-first shortest path between two waypoint ids, or null when unreachable. */
export function planPath(fromId: string, toId: string, layout: RoomLayout): Waypoint[] | null {
  const destination = waypointById(toId, layout);
  if (!destination) return null;
  if (fromId === toId) return [destination];
  const graph = buildGraph(layout);
  if (!graph.has(fromId)) return null;
  const queue: string[] = [fromId];
  const cameFrom = new Map<string, string | null>([[fromId, null]]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === toId) break;
    for (const neighbour of graph.get(current) ?? []) {
      if (cameFrom.has(neighbour)) continue;
      cameFrom.set(neighbour, current);
      queue.push(neighbour);
    }
  }
  if (!cameFrom.has(toId)) return null;
  const route: Waypoint[] = [];
  let cursor: string | null = toId;
  while (cursor) {
    const waypoint = waypointById(cursor, layout);
    if (waypoint) route.unshift(waypoint);
    cursor = cameFrom.get(cursor) ?? null;
  }
  return route.length > 0 ? route : null;
}

/** True when the node leads directly into a seat the character can sit on. */
export function isSeatApproach(id: string): boolean {
  return SEAT_WAYPOINTS.includes(id);
}

/**
 * Validate a layout: every waypoint must be walkable and every edge clear of
 * furniture. Called by the tests so a bad room edit fails loudly.
 */
export function validateLayout(layout: RoomLayout, margin = CHARACTER_RADIUS): string[] {
  const problems: string[] = [];
  for (const waypoint of layout.waypoints) {
    if (isBlocked(waypoint.position, layout, margin)) {
      problems.push(`waypoint ${waypoint.id} is inside or too close to an obstacle`);
    }
  }
  const ids = new Set(layout.waypoints.map((waypoint) => waypoint.id));
  for (const [from, to] of layout.edges) {
    if (!ids.has(from) || !ids.has(to)) {
      problems.push(`edge ${from}->${to} references an unknown waypoint`);
      continue;
    }
    const a = waypointById(from, layout);
    const b = waypointById(to, layout);
    if (a && b && segmentBlocked(a.position, b.position, layout, margin)) {
      problems.push(`edge ${from}->${to} passes through an obstacle`);
    }
  }
  return problems;
}