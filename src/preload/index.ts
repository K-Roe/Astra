import { contextBridge, ipcRenderer } from 'electron';
import {
  APP_INFO_CHANNEL,
  CHAT_CLEAR_CHANNEL,
  CHAT_SEND_CHANNEL,
  CHAT_STATUS_CHANNEL,
  CHARACTER_ASSET_CHANNEL,
  type AstraBridge,
  type AppInfo,
  type ChatStatus,
  type CharacterAssetId,
} from '../shared/contracts';

const bridge: AstraBridge = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL) as Promise<AppInfo>,
  getChatStatus: (): Promise<ChatStatus> => ipcRenderer.invoke(CHAT_STATUS_CHANNEL) as Promise<ChatStatus>,
  sendMessage: (content: string): Promise<ChatStatus> => ipcRenderer.invoke(CHAT_SEND_CHANNEL, content) as Promise<ChatStatus>,
  clearConversation: (): Promise<ChatStatus> => ipcRenderer.invoke(CHAT_CLEAR_CHANNEL) as Promise<ChatStatus>,
  readCharacterAsset: (id: CharacterAssetId): Promise<Uint8Array> =>
    ipcRenderer.invoke(CHARACTER_ASSET_CHANNEL, id) as Promise<Uint8Array>,
};

contextBridge.exposeInMainWorld('astra', bridge);
