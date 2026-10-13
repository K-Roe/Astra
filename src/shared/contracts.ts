export const APP_INFO_CHANNEL = 'astra:app-info' as const;
export const CHAT_STATUS_CHANNEL = 'astra:chat-status' as const;
export const CHAT_SEND_CHANNEL = 'astra:chat-send' as const;
export const CHAT_CLEAR_CHANNEL = 'astra:chat-clear' as const;

export interface AppInfo {
  readonly name: 'ASTRA';
  readonly version: string;
}

export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ChatStatus {
  readonly state: 'ready' | 'error';
  readonly detail: string;
  readonly messages: readonly ChatMessage[];
}

export interface AstraBridge {
  getAppInfo(): Promise<AppInfo>;
  getChatStatus(): Promise<ChatStatus>;
  sendMessage(content: string): Promise<ChatStatus>;
  clearConversation(): Promise<ChatStatus>;
}
