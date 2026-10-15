import { worldCameraFraming, type WorldCameraFraming } from './worldCamera';

export type HomeCameraMode = 'companion' | 'overview' | 'follow' | 'close' | 'desk' | 'deskSide' | 'overhead' | 'sofa';

/** One pure camera policy for desktop and compact viewports. */
export function homeCameraFraming(width: number, height: number, mode: HomeCameraMode, x = 0, z = 0): WorldCameraFraming {
  if (mode === 'deskSide' || mode === 'overhead') {
    const aspect = Math.max(0.5, width / Math.max(1, height));
    return {
      fovDegrees: 48, aspect, compact: width < 260 || height < 170,
      position: mode === 'deskSide' ? [7.5, 2.1, -0.65] : [0.65, 10, 0.65],
      target: mode === 'deskSide' ? [2.2, 0.9, -2.15] : [0.65, 0, -0.6],
    };
  }
  if (mode === 'companion') {
    const aspect = Math.max(0.5, width / Math.max(1, height));
    const fovDegrees = 48;
    const tangent = Math.tan((fovDegrees * Math.PI) / 360);
    // Frame Astra with the sofa and desk; Home retains the full floor.
    const distance = Math.max(5.1, 2.8 / (tangent * aspect), 2.45 / tangent);
    return {
      fovDegrees, aspect, compact: width < 260 || height < 170,
      position: [0.65 + distance * 0.28, 1.05 + distance * 0.43, -0.85 + distance * 0.86],
      target: [0.65, 0.95, -0.85],
    };
  }
  if (mode !== 'overview') {
    if (mode === 'close') {
      const base = worldCameraFraming(width, height, x, z);
      const scale = 0.9;
      return { ...base, position: [
        base.target[0] + (base.position[0] - base.target[0]) * scale,
        base.target[1] + (base.position[1] - base.target[1]) * scale,
        base.target[2] + (base.position[2] - base.target[2]) * scale,
      ] };
    }
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
