import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { inspectCharacterGlb, readGlb, REQUIRED_BONES, REQUIRED_CLIPS, REQUIRED_MORPHS } from '../scripts/inspect-astra-glb.mjs';

const file = path.resolve(fileURLToPath(new URL('../src/assets/astra-character-v2.glb', import.meta.url)));
const report = inspectCharacterGlb(file);

test('V2 preview is a self-contained rig with the original controller contract', () => {
  assert.equal(report.version, 2);
  assert.equal(report.skinCount, 1);
  assert.equal(report.textureCount, 0);
  assert.equal(report.imageCount, 0);
  assert.ok(report.triangles <= 30000, `triangle budget exceeded: ${report.triangles}`);
  assert.ok(report.byteLength < 8 * 1024 * 1024);
  for (const name of REQUIRED_BONES) assert.ok(report.boneNames.includes(name), `missing bone ${name}`);
  for (const name of REQUIRED_CLIPS) assert.ok(report.clipNames.includes(name), `missing clip ${name}`);
  for (const name of REQUIRED_MORPHS) assert.ok(report.morphNames.includes(name), `missing morph ${name}`);
  for (const name of ['sofa_relax', 'desk_work', 'stretch']) {
    assert.ok(report.clipNames.includes(name), `missing LW-03 clip ${name}`);
    assert.ok(report.channelsPerClip.find((clip) => clip.name === name)?.channels > 0);
  }
  assert.ok((readGlb(file).json.buffers ?? []).every((buffer) => !buffer.uri));
});
