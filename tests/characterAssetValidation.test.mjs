import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CHARACTER_CLIPS, missingRequiredCharacterClips } = require('../dist-electron/shared/characterClips.js');

test('an asset missing a required one-shot or loop is refused before animation starts', () => {
  assert.deepEqual(missingRequiredCharacterClips(CHARACTER_CLIPS), []);
  assert.deepEqual(missingRequiredCharacterClips(CHARACTER_CLIPS.filter((name) => name !== 'sit_down' && name !== 'walk')), ['walk', 'sit_down']);
});
