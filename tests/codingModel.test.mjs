import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateProposal } = require('../dist-electron/main/agent/codingModel.js');
const context = [{ file: 'src/sum.js', content: 'export const sum = (a, b) => a - b;\n' }];
const valid = { rootCause: 'wrong operator', expectedOutcome: 'addition works', risks: [], patches: [{ file: 'src/sum.js', hunks: [{ find: 'a - b', replace: 'a + b' }] }] };

test('a bounded structured patch is accepted', () => {
  assert.equal(validateProposal(valid, context).patches[0].file, 'src/sum.js');
});

test('model JSON cannot widen the file scope', () => {
  assert.throws(() => validateProposal({ ...valid, patches: [{ file: '../other-repo/secret.js', hunks: valid.patches[0].hunks }] }, context), /not supplied/);
});

test('model hunks must match uniquely and cannot be empty', () => {
  assert.throws(() => validateProposal({ ...valid, patches: [{ file: 'src/sum.js', hunks: [{ find: '', replace: 'anything' }] }] }, context), /invalid hunk/);
  assert.throws(() => validateProposal(valid, [{ file: 'src/sum.js', content: 'a - b and a - b' }]), /uniquely/);
});

test('a prose response is not treated as a tool call', () => {
  assert.throws(() => validateProposal('run npm install', context), /must be an object/);
});
