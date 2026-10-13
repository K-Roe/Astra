/**
 * Vertical extent the camera must frame, in metres, including headroom and a
 * little floor so her feet never clip the bottom edge.
 *
 * Astra Character V1 is 1.75 m tall. The LW-01 value framed a 3.4 m procedural
 * mannequin, which would render the real character at roughly half the frame.
 */
export const CHARACTER_VIEW_HEIGHT = 2.15;
export const CHARACTER_HALF_WIDTH = 0.85;

export interface WorldCameraFraming {
  readonly fovDegrees: number;
  readonly aspect: number;
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly compact: boolean;
}

/** Fit the full character framing with breathing room and a visible room corner. */
export function worldCameraFraming(
  width: number,
  height: number,
  focusX = 0,
  focusZ = 0,
): WorldCameraFraming {
  const aspect = Math.max(0.5, width / Math.max(1, height));
  const compact = width < 260 || height < 170;
  const fovDegrees = 42;
  const minimumDistance = compact ? 2.5 : 2.7;
  const verticalFit = (CHARACTER_VIEW_HEIGHT * (compact ? 1.16 : 1.2)) / (2 * Math.tan((fovDegrees * Math.PI) / 360));
  const horizontalFit = (CHARACTER_HALF_WIDTH * 2 * 1.15) / (2 * Math.tan((fovDegrees * Math.PI) / 360) * aspect);
  const distance = Math.max(minimumDistance, verticalFit, horizontalFit);
  const targetY = compact ? 0.98 : 1.0;
  const angle = compact ? 0.25 : 0.34;
  const elevation = compact ? 0.17 : 0.21;
  const depth = Math.sqrt(1 - angle * angle - elevation * elevation);

  return {
    fovDegrees,
    aspect,
    // The camera tracks where she actually stands. Framing a fixed point makes
    // her drift out of shot as soon as she walks toward the camera.
    position: [focusX + distance * angle, targetY + distance * elevation, focusZ + distance * depth],
    target: [focusX, targetY, focusZ],
    compact,
  };
}
