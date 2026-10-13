import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  inspectCharacterGlb,
  readGlb,
  REQUIRED_BONES,
  REQUIRED_CLIPS,
  REQUIRED_MORPHS,
} from '../scripts/inspect-astra-glb.mjs';

const assetPath = path.resolve(fileURLToPath(new URL('../src/assets/astra-character-v1.glb', import.meta.url)));
const report = inspectCharacterGlb(assetPath);

test('the shipped character asset is a valid glTF 2.0 binary container', () => {
  assert.equal(report.version, 2);
  assert.equal(report.asset.version, '2.0');
  assert.ok(report.binaryBytes > 0, 'the GLB must embed its buffer');
  assert.ok(report.byteLength > 0);
});

test('the asset is self-contained: no remote textures or images', () => {
  assert.equal(report.textureCount, 0, 'textures would need separate files');
  assert.equal(report.imageCount, 0);
  const { json } = readGlb(assetPath);
  const hasBuffers = (json.buffers ?? []).every((buffer) => buffer.uri === undefined);
  assert.ok(hasBuffers, 'all buffers must be embedded in the binary chunk');
});

test('the skeleton carries the bones the character controller drives', () => {
  assert.equal(report.skinCount, 1, 'expected a single skin for one armature');
  for (const bone of REQUIRED_BONES) {
    assert.ok(report.boneNames.includes(bone), `missing bone ${bone}`);
  }
  assert.ok(report.boneCount >= 40, `expected a full body rig, found ${report.boneCount} bones`);
});

test('all fifteen animation clips are exported with real channels', () => {
  for (const clip of REQUIRED_CLIPS) {
    assert.ok(report.clipNames.includes(clip), `missing clip ${clip}`);
  }
  assert.equal(report.clipNames.length, REQUIRED_CLIPS.length);
  for (const entry of report.channelsPerClip) {
    assert.ok(entry.channels > 0, `clip ${entry.name} has no channels`);
  }
  const blink = report.channelsPerClip.find((entry) => entry.name === 'blink');
  assert.ok(blink.channels > 0, 'the blink clip must animate the face');
});

test('facial morph targets and speech-ready visemes are present', () => {
  for (const morph of REQUIRED_MORPHS) {
    assert.ok(report.morphNames.includes(morph), `missing morph target ${morph}`);
  }
  assert.ok(report.morphedPrimitives > 0, 'morph targets must be attached to a primitive');
});

test('geometry stays inside the real-time triangle budget', () => {
  assert.ok(report.triangles > 0);
  assert.ok(report.triangles <= 30000, `triangle budget exceeded: ${report.triangles}`);
});

test('the asset is exported Y-up at the approved character scale', () => {
  const [width, height, depth] = report.size;
  assert.ok(Math.abs(height - 1.75) < 0.06, `expected roughly 1.75 m tall, got ${height}`);
  assert.ok(width > 0.4 && width < 0.8, `unexpected width ${width}`);
  assert.ok(depth > 0.25 && depth < 0.6, `unexpected depth ${depth}`);
});

test('the asset is small enough to ship inside the packaged application', () => {
  assert.ok(report.byteLength < 8 * 1024 * 1024, `asset is ${(report.byteLength / 1048576).toFixed(2)} MB`);
  assert.ok(report.materialCount > 0, 'materials must be embedded');
});

test('a corrupt or missing asset is rejected rather than silently accepted', () => {
  assert.throws(() => readGlb(path.resolve(fileURLToPath(new URL('../package.json', import.meta.url)))), /glTF magic/);
  assert.throws(() => readGlb(path.resolve(fileURLToPath(new URL('../src/assets/does-not-exist.glb', import.meta.url)))), /ENOENT|no such file/i);
});