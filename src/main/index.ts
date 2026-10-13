import { app, BrowserWindow, ipcMain, session } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { APP_INFO_CHANNEL, CHAT_CLEAR_CHANNEL, CHAT_SEND_CHANNEL, CHAT_STATUS_CHANNEL, type AppInfo } from '../shared/contracts';
import { ChatService } from './chatService';
import { createWindowOptions } from './windowOptions';

let mainWindow: BrowserWindow | null = null;
let chat: ChatService;

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
