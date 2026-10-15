import type { RoomLayout } from './characterNavigation';

/**
 * LW-03 compact open-plan home. Coordinates are metres on the floor.
 * Furniture backs and fixed cabinetry are obstacles; the seat waypoints sit
 * in the free front edge of their cushions so a single rig can approach them.
 * The matching visible geometry is authored in renderer/world/scene.ts.
 */
export const HOME_ROOM: RoomLayout = {
  bounds: { minX: -4.7, maxX: 4.7, minZ: -3.3, maxZ: 3.1 },
  obstacles: [
    { name: 'bed', minX: -4.35, maxX: -2.7, minZ: -3.05, maxZ: -2.0 },
    { name: 'bookcase', minX: -4.5, maxX: -4.0, minZ: 0.45, maxZ: 1.65 },
    { name: 'sofa back', minX: -1.8, maxX: 0.0, minZ: -2.65, maxZ: -2.2 },
    { name: 'desk', minX: 1.5, maxX: 3.2, minZ: -3.1, maxZ: -2.55 },
    { name: 'kitchen cabinets', minX: 4.05, maxX: 4.6, minZ: -0.75, maxZ: 1.45 },
    { name: 'dining table', minX: 2.05, maxX: 3.1, minZ: 1.55, maxZ: 2.3 },
  ],
  waypoints: [
    { id: 'centre', position: { x: 0, z: 0.65 }, facing: Math.PI },
    { id: 'living_stand', position: { x: -0.9, z: -0.55 }, facing: Math.PI },
    { id: 'sofa_front', position: { x: -0.9, z: -1.25 }, facing: 0, next: 'sofa_seat' },
    { id: 'sofa_seat', position: { x: -0.9, z: -1.85 }, facing: Math.PI },
    // Enter the chair from its left side; its back is on the walking side.
    { id: 'desk_front', position: { x: 1.38, z: -2.2 }, facing: Math.PI / 2, next: 'desk_seat' },
    { id: 'desk_seat', position: { x: 2.25, z: -2.25 }, facing: 0 },
    { id: 'kitchen_front', position: { x: 3.15, z: 0.35 }, facing: Math.PI / 2 },
    { id: 'kitchen', position: { x: 3.4, z: 0.9 }, facing: Math.PI / 2 },
    { id: 'bedroom_front', position: { x: -2.6, z: 0.1 }, facing: 0 },
    { id: 'bedside', position: { x: -3.25, z: -1.25 }, facing: 0 },
    { id: 'dining_front', position: { x: 1.2, z: 2.25 }, facing: Math.PI / 2 },
    { id: 'front_left', position: { x: -2.55, z: 1.8 }, facing: Math.PI },
    { id: 'front_right', position: { x: 0.3, z: 2.45 }, facing: Math.PI },
  ],
  edges: [
    ['centre', 'living_stand'],
    ['living_stand', 'sofa_front'],
    ['sofa_front', 'sofa_seat'],
    ['centre', 'desk_front'],
    ['desk_front', 'desk_seat'],
    ['centre', 'kitchen_front'],
    ['kitchen_front', 'kitchen'],
    ['centre', 'bedroom_front'],
    ['bedroom_front', 'bedside'],
    ['centre', 'dining_front'],
    ['centre', 'front_left'],
    ['centre', 'front_right'],
    ['front_left', 'bedroom_front'],
    ['front_right', 'dining_front'],
  ],
};
