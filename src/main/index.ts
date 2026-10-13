import { app, BrowserWindow, ipcMain, session } from 'electron';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  APP_INFO_CHANNEL,
  CHAT_CLEAR_CHANNEL,
  CHAT_SEND_CHANNEL,
  CHAT_STATUS_CHANNEL,
  CHARACTER_ASSET_CHANNEL,
  CHARACTER_ASSET_IDS,
  type AppInfo,
  type CharacterAssetId,
} from '../shared/contracts';
import { ChatService } from './chatService';
import { createWindowOptions } from './windowOptions';

let mainWindow: BrowserWindow | null = null;
let chat: ChatService;

/**
 * Vite may emit the model with a content hash or copy it verbatim from
 * `publicDir`, so both forms are accepted and the result is cached.
 */
const assetPathCache = new Map<CharacterAssetId, string>();

async function resolveCharacterAsset(id: CharacterAssetId): Promise<string> {
  const cached = assetPathCache.get(id);
  if (cached) return cached;
  if (!CHARACTER_ASSET_IDS.includes(id)) throw new Error('Unknown character asset');

  const rendererDir = path.resolve(__dirname, '../../dist/renderer');
  // Matches `astra-character-v1.glb` and `astra-character-v1-<hash>.glb` only.
  const pattern = new RegExp(`^${id}(?:-[\\w-]+)?\\.glb$`);
  for (const dir of [path.join(rendererDir, 'assets'), rendererDir]) {
    const entries = await readdir(dir).catch(() => [] as string[]);
    const match = entries.filter((entry) => pattern.test(entry)).sort();
    if (match.length === 1) {
      const resolved = path.resolve(dir, match[0]);
      // Defence in depth: never serve anything outside the built renderer.
      if (!resolved.startsWith(rendererDir + path.sep)) throw new Error('Asset resolved outside the bundle');
      assetPathCache.set(id, resolved);
      return resolved;
    }
  }
  throw new Error(`Built character asset ${id}.glb was not found`);
}

function denyUnexpectedContent(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

function registerIpc(): void {
  const requirePrimaryFrame = (event: Electron.IpcMainInvokeEvent): void => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Untrusted Astra request');
    }
  };

  ipcMain.handle(APP_INFO_CHANNEL, (event): AppInfo => {
    requirePrimaryFrame(event);
    return { name: 'ASTRA', version: app.getVersion() };
  });
  ipcMain.handle(CHAT_STATUS_CHANNEL, (event) => { requirePrimaryFrame(event); return chat.getStatus(); });
  ipcMain.handle(CHAT_SEND_CHANNEL, (event, content: unknown) => { requirePrimaryFrame(event); return chat.send(content); });
  ipcMain.handle(CHAT_CLEAR_CHANNEL, (event) => { requirePrimaryFrame(event); return chat.clearConversation(); });
  ipcMain.handle(CHARACTER_ASSET_CHANNEL, async (event, id: unknown): Promise<Uint8Array> => {
    requirePrimaryFrame(event);
    if (typeof id !== 'string' || !CHARACTER_ASSET_IDS.includes(id as CharacterAssetId)) {
      throw new Error('Unknown character asset');
    }
    const bytes = await readFile(await resolveCharacterAsset(id as CharacterAssetId));
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  });
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, '../preload/index.js');
  const rendererPath = path.join(__dirname, '../../dist/renderer/index.html');
  mainWindow = new BrowserWindow(createWindowOptions(preloadPath));
  mainWindow.on('closed', () => { mainWindow = null; });
  void mainWindow.loadFile(rendererPath);
}

void app.whenReady().then(async () => {
  const personalityPath = path.join(app.getAppPath(), 'docs', 'ASTRA_PERSONALITY.md');
  const personality = await readFile(personalityPath, 'utf8').catch(() => '');
  chat = new ChatService(personality);
  denyUnexpectedContent();
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => chat?.shutdown());
