import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWindowOptions } = require('../dist-electron/main/windowOptions.js');
const { APP_INFO_CHANNEL, CHAT_STATUS_CHANNEL, CHAT_SEND_CHANNEL, CHAT_CLEAR_CHANNEL } = require('../dist-electron/shared/contracts.js');

test('window denies renderer privileges and enables isolation', () => {
  const options = createWindowOptions('C:\\Astra\\preload.js');
  assert.equal(options.title, 'ASTRA');
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(options.webPreferences.webviewTag, false);
  assert.equal(options.webPreferences.preload, 'C:\\Astra\\preload.js');
});

test('built renderer is local and declares restrictive CSP', async () => {
  const html = await readFile(path.resolve('dist/renderer/index.html'), 'utf8');
  assert.match(html, /<title>ASTRA<\/title>/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|https?:\/\//);
  assert.equal(APP_INFO_CHANNEL, 'astra:app-info');
  assert.equal(CHAT_STATUS_CHANNEL, 'astra:chat-status');
  assert.equal(CHAT_SEND_CHANNEL, 'astra:chat-send');
  assert.equal(CHAT_CLEAR_CHANNEL, 'astra:chat-clear');
});
