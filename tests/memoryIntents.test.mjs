import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { detectMemoryIntent, suggestMemory } = require('../dist-electron/main/memory/memoryIntents.js');

test('explicit remembering is detected and the statement is extracted', () => {
  assert.deepEqual(
    detectMemoryIntent('Astra, remember that I prefer React and TypeScript.'),
    { kind: 'remember', text: 'I prefer React and TypeScript.', subject: 'preference.react_typescript' },
  );
  assert.equal(detectMemoryIntent('Remember that my dog is called Rex').text, 'my dog is called Rex');
  assert.equal(detectMemoryIntent('keep in mind that the tests run with npm test').text, 'the tests run with npm test');
  assert.equal(detectMemoryIntent("don't forget my wifi is on the second floor").text, 'my wifi is on the second floor');
});

test('recall questions are detected with their topic', () => {
  assert.equal(detectMemoryIntent('Astra, what do you remember about me?')?.kind, 'recall');
  assert.equal(detectMemoryIntent('what did I tell you about BrightSpeakAPI?')?.text, 'BrightSpeakAPI');
  assert.equal(detectMemoryIntent('do you remember my cat?')?.kind, 'recall');
});

test('questions about Astra memory persistence never become save requests', () => {
  assert.equal(detectMemoryIntent('Will you remember this test word after I close Astra?')?.kind, 'explain_persistence');
  assert.equal(detectMemoryIntent('How does your memory work?')?.kind, 'explain_persistence');
  assert.equal(detectMemoryIntent('Will you remember this?')?.kind, 'explain_persistence');
  assert.equal(detectMemoryIntent('Can you remember this after I restart Astra?')?.kind, 'explain_persistence');
  assert.equal(detectMemoryIntent('Can you remember my cat?'), null);
});

test('updates and corrections are distinguished from new memories', () => {
  const updated = detectMemoryIntent('update my frontend stack to React with plain JavaScript');
  assert.equal(updated.kind, 'update');
  assert.match(updated.text, /React with plain JavaScript/);
  assert.equal(detectMemoryIntent('Actually, I prefer Svelte instead').kind, 'update');
  assert.equal(detectMemoryIntent('no, I never want automatic installs').kind, 'update');
});

test('forgetting is detected and its target is cleaned of filler words', () => {
  assert.deepEqual(detectMemoryIntent('Astra, forget that information.'), { kind: 'forget', text: 'information.', subject: 'preference.information' });
  const targeted = detectMemoryIntent('forget my frontend preference');
  assert.equal(targeted.kind, 'forget');
  assert.equal(targeted.text, 'frontend');
});

test('a refusal to remember the conversation is detected', () => {
  assert.equal(detectMemoryIntent("Astra, don't remember this conversation.").kind, 'forget_conversation');
  assert.equal(detectMemoryIntent('no need to remember this').kind, 'forget_conversation');
});

test('ordinary conversation is never treated as a memory command', () => {
  for (const message of [
    'What does React use for state management?',
    'Remembering my trip last year was good.',
    'Can you remind me to water the plants?',
    'Fix the failing test in src/sum.js',
    'Show me my repositories',
    '',
    '   ',
  ]) {
    assert.equal(detectMemoryIntent(message), null, `should not be a memory intent: ${message}`);
  }
});

test('an over-long message is refused outright', () => {
  assert.equal(detectMemoryIntent(`remember that ${'x'.repeat(2100)}`), null);
});

test('suggestions require a stable first-person preference and reject secrets', () => {
  const suggestion = suggestMemory('I prefer TypeScript strict mode for every new project.');
  assert.equal(suggestion.text, 'I prefer TypeScript strict mode for every new project');
  assert.equal(suggestion.subject.startsWith('preference.'), true);
  assert.equal(suggestMemory('I prefer to keep my api key in the password manager'), null);
  assert.equal(suggestMemory('short'), null);
  assert.equal(suggestMemory('The docs say to run npm install first'), null);
});

test('a vocative does not prevent detection', () => {
  for (const prefix of ['Astra,', 'astra ', 'Hey Astra,', 'Please ', 'okay ']) {
    assert.equal(detectMemoryIntent(`${prefix}remember that I use Neovim`).kind, 'remember', prefix);
  }
});
