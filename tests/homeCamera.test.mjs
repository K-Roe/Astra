import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { homeCameraFraming } = require('../dist-electron/shared/homeCamera.js');

test('overview fits a compact home without invalid camera values', () => {
  for (const [width, height] of [[343, 233], [210, 120], [700, 500]]) {
    const view = homeCameraFraming(width, height, 'overview');
    assert.ok(view.position.every(Number.isFinite));
    assert.ok(view.target.every(Number.isFinite));
    assert.ok(view.position[1] > view.target[1]);
    assert.ok(view.position[2] > view.target[2]);
  }
});

test('follow keeps the character as focus; desk and sofa are stable named views', () => {
  assert.deepEqual(homeCameraFraming(343, 233, 'follow', 1, 2).target.slice(0, 3), [1, 1, 2]);
  assert.equal(homeCameraFraming(343, 233, 'desk').target[0], 2.25);
  assert.equal(homeCameraFraming(343, 233, 'sofa').target[0], -0.9);
});

test('default companion view brings the main activity area closer than full overview', () => {
  const near = homeCameraFraming(520, 400, 'companion');
  const home = homeCameraFraming(520, 400, 'overview');
  const range = (view) => Math.hypot(...view.position.map((value, index) => value - view.target[index]));
  assert.ok(range(near) < range(home));
  assert.ok(near.target[0] > 0 && near.target[0] < 2);
  assert.ok(homeCameraFraming(520, 400, 'close').position[2] < homeCameraFraming(520, 400, 'follow').position[2]);
  assert.ok(homeCameraFraming(520, 400, 'overhead').position[1] > 8);
});
