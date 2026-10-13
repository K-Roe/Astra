export interface WorldCameraFraming {
  readonly fovDegrees: number;
  readonly aspect: number;
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly compact: boolean;
}

/** Fit the full 3.4 m procedural mannequin with breathing room and a visible room corner. */
export function worldCameraFraming(width: number, height: number): WorldCameraFraming {
  const aspect = Math.max(0.5, width / Math.max(1, height));
  const compact = width < 260 || height < 170;
  const fovDegrees = 42;
  const minimumDistance = compact ? 5.6 : 5.8;
  const verticalFit = (3.55 * (compact ? 1.24 : 1.29)) / (2 * Math.tan(fovDegrees * Math.PI / 360));
  const horizontalFit = (1.8 * 1.2) / (2 * Math.tan(fovDegrees * Math.PI / 360) * aspect);
  const distance = Math.max(minimumDistance, verticalFit, horizontalFit);
  const targetY = compact ? 1.61 : 1.64;
  const angle = compact ? 0.25 : 0.34;
  const elevation = compact ? 0.17 : 0.21;
  const depth = Math.sqrt(1 - angle * angle - elevation * elevation);

  return {
    fovDegrees,
    aspect,
    position: [distance * angle, targetY + distance * elevation, distance * depth],
    target: [0, targetY, 0],
    compact,
  };
}
