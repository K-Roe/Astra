import { contextBridge, ipcRenderer } from 'electron';
import {
  APP_INFO_CHANNEL,
  CHAT_CLEAR_CHANNEL,
  CHAT_CANCEL_CHANNEL,
  CHAT_SEND_CHANNEL,
  CHAT_STATUS_CHANNEL,
  CHARACTER_ASSET_CHANNEL,
  type AstraBridge,
  type AppInfo,
  type ChatStatus,
  type CharacterAssetId,
} from '../shared/contracts';
import { INTELLIGENCE_CHANNELS, type IntelligenceBridge } from '../shared/intelligence';

/** Unwraps the `{ ok, value | error }` envelope used by every intelligence channel. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const response = (await ipcRenderer.invoke(channel, ...args)) as { ok: boolean; value?: T; error?: string };
  if (!response?.ok) throw new Error(response?.error ?? 'Astra could not complete that request');
  return response.value as T;
}

const bridge: AstraBridge = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL) as Promise<AppInfo>,
  getChatStatus: (): Promise<ChatStatus> => ipcRenderer.invoke(CHAT_STATUS_CHANNEL) as Promise<ChatStatus>,
  sendMessage: (content: string): Promise<ChatStatus> => ipcRenderer.invoke(CHAT_SEND_CHANNEL, content) as Promise<ChatStatus>,
  clearConversation: (): Promise<ChatStatus> => ipcRenderer.invoke(CHAT_CLEAR_CHANNEL) as Promise<ChatStatus>,
  cancelCurrentRequest: (): Promise<ChatStatus> => ipcRenderer.invoke(CHAT_CANCEL_CHANNEL) as Promise<ChatStatus>,
  readCharacterAsset: (id: CharacterAssetId): Promise<Uint8Array> =>
    ipcRenderer.invoke(CHARACTER_ASSET_CHANNEL, id) as Promise<Uint8Array>,
};

const C = INTELLIGENCE_CHANNELS;
const intelligence: IntelligenceBridge = {
  listSources: () => call(C.sources),
  addSource: (input) => call(C.sourceAdd, input),
  learnSource: (id) => call(C.sourceLearn, id),
  revokeSource: (id) => call(C.sourceRevoke, id),
  deleteSourceKnowledge: (id) => call(C.sourceDelete, id),
  searchKnowledge: (query, limit) => call(C.knowledgeSearch, query, limit),
  knowledgeStats: () => call(C.knowledgeStats),
  listMemory: () => call(C.memoryList),
  rememberMemory: (input) => call(C.memoryRemember, input),
  correctMemory: (original, corrected, reason) => call(C.memoryCorrect, { original, corrected, reason }),
  forgetMemory: (id) => call(C.memoryForget, id),
  listCorrections: () => call(C.memoryCorrections),
  listProjects: () => call(C.projectsList),
  inspectProject: (root) => call(C.projectInspect, root),
  readProjectFile: (root, relativePath) => call(C.projectReadFile, root, relativePath),
  searchProject: (root, query) => call(C.projectSearch, root, query),
  requestApproval: (input) => call(C.approvalsRequest, input),
  decideApproval: (input) => call(C.approvalsDecide, input),
  listApprovals: () => call(C.approvalsList),
  listAudit: (limit) => call(C.auditList, limit),
  createTask: (input) => call(C.tasksCreate, input),
  listTasks: () => call(C.tasksList),
  transitionTask: (input) => call(C.tasksTransition, input),
  cancelTask: (input) => call(C.tasksCancel, input),
  confirmTask: (input) => call(C.tasksConfirm, input),
  taskEvents: (input) => call(C.tasksEvents, input),
  codingBenchmark: () => call(C.codingBenchmark),
  codingSnapshot: () => call(C.codingSnapshot),
  codingSelectRepository: (nameOrPath) => call(C.codingSelectRepo, nameOrPath),
  codingApprove: () => call(C.codingDecide, { decision: 'approve' }),
  codingReject: (reason) => call(C.codingDecide, { decision: 'reject', ...(reason ? { reason } : {}) }),
  codingCreateBranch: () => call(C.codingBranch),
  codingApply: (input) => call(C.codingApply, input),
  codingCreateRepository: (input) => call(C.codingCreateRepo, input),
  codingRunCommand: (input) => call(C.codingRunCommand, input),
  codingReview: () => call(C.codingReview),
  codingComplete: (summary) => call(C.codingDecide, { decision: 'complete', ...(summary ? { summary } : {}) }),
  codingCancel: (reason) => call(C.codingCancel, reason),
  codingRestore: (taskId) => call(C.codingRestore, taskId),
  codingConfirmResume: () => call(C.codingDecide, { decision: 'confirm' }),
  codingDecide: (input) => call(C.codingDecide, input),
};

contextBridge.exposeInMainWorld('astra', bridge);
contextBridge.exposeInMainWorld('astraIntelligence', intelligence);
