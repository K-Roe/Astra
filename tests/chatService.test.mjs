import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ChatService, MODEL_DIGEST } = require('../dist-electron/main/chatService.js');

function mockOllama({ digest = MODEL_DIGEST, unavailable = false } = {}) {
  const chats = [];
  const request = async (url, init) => {
    assert.equal(new globalThis.URL(url).origin, 'http://127.0.0.1:11434');
    if (unavailable) throw new Error('connection refused');
    const route = new globalThis.URL(url).pathname;
    if (route === '/api/tags') return globalThis.Response.json({ models: [{ name: 'gemma3:4b', digest }] });
    if (route === '/api/show') return globalThis.Response.json({ details: { runner: 'llamacpp' } });
    if (route === '/api/ps') return globalThis.Response.json({ models: [{ name: 'gemma3:4b', digest }] });
    if (route === '/api/chat') {
      const body = JSON.parse(init.body);
      chats.push(body);
      return globalThis.Response.json({ message: { role: 'assistant', content: `Answer ${chats.length}` } });
    }
    throw new Error(`Unexpected route ${route}`);
  };
  return { request, chats };
}

test('approved local model applies personality and keeps context only in the session', async () => {
  const fake = mockOllama();
  const service = new ChatService('# Astra personality\nBe calm and honest.', fake.request);
  assert.equal((await service.getStatus()).state, 'ready');
  const first = await service.send('Hello');
  assert.deepEqual(first.messages, [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Answer 1' }]);
  await service.send('What did I say?');
  assert.deepEqual(fake.chats[1].messages.slice(1), [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Answer 1' },
    { role: 'user', content: 'What did I say?' },
  ]);
  assert.match(fake.chats[0].messages[0].content, /Be calm and honest/);
  assert.match(fake.chats[0].messages[0].content, /no persistent personal memory/);
  assert.equal(fake.chats[0].options.num_ctx, 4096);
  assert.equal(fake.chats[0].model, 'gemma3:4b');
  service.clearConversation();
  assert.equal((await service.getStatus()).messages.length, 0);
  await service.send('Start fresh');
  assert.deepEqual(fake.chats[2].messages.slice(1), [{ role: 'user', content: 'Start fresh' }]);
  service.shutdown();
  assert.equal((await service.getStatus()).messages.length, 0);
  const restarted = new ChatService('# Astra personality', fake.request);
  assert.equal((await restarted.getStatus()).messages.length, 0);
});

test('unavailable Ollama returns a safe error and does not accept a message', async () => {
  const fake = mockOllama({ unavailable: true });
  const service = new ChatService('Astra personality', fake.request);
  const status = await service.getStatus();
  assert.equal(status.state, 'error');
  assert.match(status.detail, /Cannot reach the local Ollama service/);
  await assert.rejects(service.send('Private test text'), /Cannot reach the local Ollama service/);
  assert.equal(fake.chats.length, 0);
  assert.equal(service.clearConversation().messages.length, 0);
});

test('changed model digest refuses inference', async () => {
  const fake = mockOllama({ digest: 'different-digest' });
  const service = new ChatService('Astra personality', fake.request);
  assert.equal((await service.getStatus()).state, 'error');
  await assert.rejects(service.send('Hello'), /approved Gemma model digest/);
  assert.equal(fake.chats.length, 0);
});

test('invalid input and missing personality never reach Ollama chat', async () => {
  const fake = mockOllama();
  const service = new ChatService('', fake.request);
  await assert.rejects(service.send('Hello'), /personality configuration/);
  await assert.rejects(service.send(' '.repeat(5)), /Enter a message/);
  await assert.rejects(service.send('x'.repeat(8001)), /Enter a message/);
  assert.equal(fake.chats.length, 0);
});

test('clearing while a reply is pending prevents stale history', async () => {
  const fake = mockOllama();
  let release;
  let started;
  const chatStarted = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const request = async (url, init) => {
    if (new globalThis.URL(url).pathname === '/api/chat') {
      started();
      await gate;
    }
    return fake.request(url, init);
  };
  const service = new ChatService('Astra personality', request);
  const pending = service.send('Do not retain this');
  await chatStarted;
  assert.equal(service.clearConversation().messages.length, 0);
  release();
  await assert.rejects(pending, /Conversation was cleared/);
  assert.equal((await service.getStatus()).messages.length, 0);
});
