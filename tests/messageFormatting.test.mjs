import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { splitMessage } = require('../dist-electron/shared/messageFormatting.js');

test('multiline text and fenced code remain separate readable blocks', () => {
  assert.deepEqual(splitMessage('Here is the code:\n```ts\nconst value = 2;\nconsole.log(value);\n```\nThat is all.'), [
    { kind: 'text', value: 'Here is the code:' },
    { kind: 'code', value: 'const value = 2;\nconsole.log(value);', language: 'ts' },
    { kind: 'text', value: 'That is all.' },
  ]);
});

test('unclosed code fence stays visible as text', () => {
  assert.deepEqual(splitMessage('Start\n```python\nprint("hello")'), [
    { kind: 'text', value: 'Start' },
    { kind: 'text', value: '```python\nprint("hello")' },
  ]);
});
