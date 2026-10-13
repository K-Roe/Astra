import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
const { worldCameraFraming } = require('../dist-electron/shared/worldCamera.js');
const { summarizeWorldFrames } = require('../dist-electron/shared/worldPerformance.js');

function cameraFor(width, height) {
  const framing = worldCameraFraming(width, height);
  const camera = new THREE.PerspectiveCamera(framing.fovDegrees, framing.aspect, 0.1, 30);
  camera.position.set(...framing.position);
  camera.lookAt(...framing.target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return { framing, camera };
}

test('full-body mannequin bounds fit desktop and compact cameras without aspect distortion', () => {
  for (const [width, height] of [[343, 261], [200, 105], [450, 430]]) {
    const { framing, camera } = cameraFor(width, height);
    assert.equal(framing.aspect, width / height);
    for (const x of [-0.95, 0.95]) {
      for (const y of [-0.13, 3.42]) {
        for (const z of [-0.4, 0.6]) {
          const point = new THREE.Vector3(x, y, z).project(camera);
          assert(Math.abs(point.x) < 0.98 && Math.abs(point.y) < 0.98, `Clipped at ${width}x${height}: ${JSON.stringify(point)}`);
        }
      }
    }
  }
  const desktop = worldCameraFraming(343, 261);
  const compact = worldCameraFraming(200, 105);
  assert.equal(compact.compact, true);
  assert(Math.hypot(...compact.position) < Math.hypot(...desktop.position), 'Compact camera should be closer');
});

test('frame summary excludes resize draws and reports interval and CPU cost distributions', () => {
  const frame = (intervalMs, renderCpuMs, source = 'idle') => ({ timeMs: 0, intervalMs, renderCpuMs, source, drawCalls: 31, triangles: 524 });
  const result = summarizeWorldFrames([frame(null, 1, 'resize'), frame(30, 2), frame(33, 3), frame(34, 4), frame(60, 5)]);
  assert.equal(result.frames, 4);
  assert.equal(result.averageIntervalMs, 39.25);
  assert.equal(result.p95IntervalMs, 60);
  assert.equal(result.averageRenderCpuMs, 3.5);
  assert.equal(result.p95RenderCpuMs, 5);
  assert.equal(result.drawCalls, 31);
  assert.equal(result.triangles, 524);
  assert.equal(summarizeWorldFrames([]).averageFps, null);
});
