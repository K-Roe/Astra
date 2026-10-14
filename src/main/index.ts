import { app, BrowserWindow, ipcMain, session } from 'electron';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  APP_INFO_CHANNEL,
  CHAT_CLEAR_CHANNEL,
  CHAT_CANCEL_CHANNEL,
  CHAT_SEND_CHANNEL,
  CHAT_STATUS_CHANNEL,
  CHARACTER_ASSET_CHANNEL,
  CHARACTER_ASSET_IDS,
  type AppInfo,
  type CharacterAssetId,
} from '../shared/contracts';
import { ChatService } from './chatService';
import { IntelligenceService, defaultDatabasePath } from './intelligenceService';
import { createWindowOptions } from './windowOptions';
import { INTELLIGENCE_CHANNELS } from '../shared/intelligence';

let mainWindow: BrowserWindow | null = null;
let chat: ChatService;
let intelligence: IntelligenceService;

// Acceptance runs must never attach to Karl's personal memory or task DB.
const acceptanceProfile = process.env.ASTRA_CA01_PROFILE;
if (process.argv.includes('--ca01-acceptance') && acceptanceProfile) {
  const resolved = path.resolve(acceptanceProfile);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('CA-01 acceptance profile must be disposable and under TEMP');
  app.setPath('userData', resolved);
}

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
  // Matches only a named, bundled V1 or V2 asset (optionally Vite hashed).
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
  ipcMain.handle(CHAT_CANCEL_CHANNEL, (event) => { requirePrimaryFrame(event); return chat.cancelCurrentRequest(); });
  ipcMain.handle(CHARACTER_ASSET_CHANNEL, async (event, id: unknown): Promise<Uint8Array> => {
    requirePrimaryFrame(event);
    if (typeof id !== 'string' || !CHARACTER_ASSET_IDS.includes(id as CharacterAssetId)) {
      throw new Error('Unknown character asset');
    }
    const bytes = await readFile(await resolveCharacterAsset(id as CharacterAssetId));
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  });
}

/**
 * Intelligence IPC.
 *
 * Every handler is registered explicitly rather than through a generic
 * dispatch table, so the privileged surface stays readable and each call is
 * validated against the primary frame. Rejections are returned as plain data
 * so a failure in the renderer can never take the main process down.
 */
function registerIntelligenceIpc(): void {
  type GuardedResult = { ok: true; value: unknown } | { ok: false; error: string };
  const guard =
    (handler: (...args: never[]) => unknown) =>
    async (event: Electron.IpcMainInvokeEvent, ...args: unknown[]): Promise<GuardedResult> => {
      if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
        throw new Error('Untrusted Astra request');
      }
      try {
        return { ok: true, value: await handler(...(args as never[])) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    };

  const C = INTELLIGENCE_CHANNELS;
  ipcMain.handle(C.sources, guard(() => intelligence.listSources()));
  ipcMain.handle(C.sourceAdd, guard((input: never) => intelligence.addSource(input)));
  ipcMain.handle(C.sourceLearn, guard((id: never) => intelligence.learnSource(id)));
  ipcMain.handle(C.sourceRevoke, guard((id: never) => intelligence.revokeSource(id)));
  ipcMain.handle(C.sourceDelete, guard((id: never) => intelligence.deleteSourceKnowledge(id)));
  ipcMain.handle(C.knowledgeSearch, guard((query: never, limit: never) => intelligence.searchKnowledge(query, limit)));
  ipcMain.handle(C.knowledgeStats, guard(() => intelligence.knowledgeStats()));
  ipcMain.handle(C.memoryList, guard(() => intelligence.listMemory()));
  ipcMain.handle(C.memoryRemember, guard((input: never) => intelligence.rememberMemory(input)));
  ipcMain.handle(C.memoryCorrect, guard((input: { original: string; corrected: string; reason?: string }) =>
    intelligence.correctMemory(input.original, input.corrected, input.reason)));
  ipcMain.handle(C.memoryForget, guard((id: never) => intelligence.forgetMemory(id)));
  ipcMain.handle(C.memoryCorrections, guard(() => intelligence.listCorrections()));
  ipcMain.handle(C.projectsList, guard(() => intelligence.listProjects()));
  ipcMain.handle(C.projectInspect, guard((root: never) => intelligence.inspectProject(root)));
  ipcMain.handle(C.projectReadFile, guard((root: never, relativePath: never) => intelligence.readProjectFile(root, relativePath)));
  ipcMain.handle(C.projectSearch, guard((root: never, query: never) => intelligence.searchProject(root, query)));
  ipcMain.handle(C.approvalsRequest, guard((input: never) => intelligence.requestApproval(input)));
  ipcMain.handle(C.approvalsDecide, guard((input: never) => intelligence.decideApproval(input)));
  ipcMain.handle(C.approvalsList, guard(() => intelligence.listApprovals()));
  ipcMain.handle(C.auditList, guard((limit: never) => intelligence.listAudit(limit)));
  ipcMain.handle(C.tasksCreate, guard((input: never) => intelligence.createTask(input)));
  ipcMain.handle(C.tasksList, guard(() => intelligence.listTasks()));
  ipcMain.handle(C.tasksTransition, guard((input: never) => intelligence.transitionTask(input)));
  ipcMain.handle(C.tasksCancel, guard((input: never) => intelligence.cancelTask(input)));
  ipcMain.handle(C.tasksConfirm, guard((input: never) => intelligence.confirmTask(input)));
  ipcMain.handle(C.tasksEvents, guard((input: never) => intelligence.taskEvents(input)));
  ipcMain.handle(C.codingBenchmark, guard(() => intelligence.codingBenchmark()));
  ipcMain.handle(C.codingSnapshot, guard(() => intelligence.codingSnapshot()));
  ipcMain.handle(C.codingSelectRepo, guard((nameOrPath: never) => intelligence.codingSelectRepository(nameOrPath)));
  ipcMain.handle(C.codingDecide, guard((input: never) => intelligence.codingDecide(input)));
  ipcMain.handle(C.codingBranch, guard(() => intelligence.codingCreateBranch()));
  ipcMain.handle(C.codingApply, guard((input: never) => intelligence.codingApply(input)));
  ipcMain.handle(C.codingCreateRepo, guard((input: never) => intelligence.codingCreateRepository(input)));
  ipcMain.handle(C.codingRunCommand, guard((input: never) => intelligence.codingRunCommand(input)));
  ipcMain.handle(C.codingReview, guard(() => intelligence.codingReview()));
  ipcMain.handle(C.codingCancel, guard((reason: never) => intelligence.codingCancel(reason)));
  ipcMain.handle(C.codingRestore, guard((taskId: never) => intelligence.codingRestore(taskId)));
  ipcMain.handle(C.codingEvents, guard(() => intelligence.codingSnapshot()));
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
  // Chat is grounded in the knowledge base, so the service is created first and
  // its retrieval hook is handed to the conversation layer.
  intelligence = new IntelligenceService({ databasePath: defaultDatabasePath() });
  chat = new ChatService(personality, fetch, (query: string) => intelligence.groundQuery(query), intelligence.codingBridge);
  // Anything mid-flight at shutdown is recovered for review, never resumed.
  const interrupted = intelligence.recoverInterruptedTasks();
  if (interrupted.length > 0) {
    console.log(`Astra recovered ${interrupted.length} interrupted coding task(s) awaiting confirmation.`);
  }
  denyUnexpectedContent();
  registerIpc();
  registerIntelligenceIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
let shutdownStarted = false;
app.on('before-quit', (event) => {
  if (shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  chat?.shutdown();
  void intelligence?.shutdown().finally(() => app.quit());
});
