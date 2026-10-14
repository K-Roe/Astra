import { worldCameraFraming, type WorldCameraFraming } from './worldCamera';

export type HomeCameraMode = 'overview' | 'follow' | 'desk' | 'sofa';

/** One pure camera policy for desktop and compact viewports. */
export function homeCameraFraming(width: number, height: number, mode: HomeCameraMode, x = 0, z = 0): WorldCameraFraming {
  if (mode !== 'overview') {
    const focus = mode === 'desk' ? { x: 2.25, z: -2.25 } : mode === 'sofa' ? { x: -0.9, z: -1.85 } : { x, z };
    return worldCameraFraming(width, height, focus.x, focus.z);
  }
  const aspect = Math.max(0.5, width / Math.max(1, height));
  const compact = width < 260 || height < 170;
  const fovDegrees = 52;
  const tangent = Math.tan((fovDegrees * Math.PI) / 360);
  const distance = Math.max(8.5, 5.3 / (tangent * aspect), 3.9 / tangent);
  return {
    fovDegrees,
    aspect,
    compact,
    position: [distance * 0.34, 1 + distance * 0.5, distance * 0.8],
    target: [0, 0.95, -0.1],
  };
}
