export const APP_INFO_CHANNEL = 'astra:app-info' as const;
export const CHAT_STATUS_CHANNEL = 'astra:chat-status' as const;
export const CHAT_SEND_CHANNEL = 'astra:chat-send' as const;
export const CHAT_CLEAR_CHANNEL = 'astra:chat-clear' as const;
export const CHAT_CANCEL_CHANNEL = 'astra:chat-cancel-current' as const;
export const CHARACTER_ASSET_CHANNEL = 'astra:character-asset' as const;

/**
 * Bundled character assets the renderer may request. The renderer cannot pass a
 * path: it names an asset and the main process resolves the built file itself.
 */
export const CHARACTER_ASSET_IDS = ['astra-character-v1', 'astra-character-v2'] as const;
export type CharacterAssetId = (typeof CHARACTER_ASSET_IDS)[number];

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
  /**
   * A memory Astra noticed in Karl's own words but has **not** stored. Nothing
   * is saved until Karl accepts it in the interface.
   */
  readonly memorySuggestion?: { readonly text: string; readonly subject: string } | null;
  /** How many personal memories are currently active. */
  readonly memoryCount?: number;
  /** True only when the persistent personal-memory service is connected. */
  readonly memoryAvailable: boolean;
}

export interface AstraBridge {
  getAppInfo(): Promise<AppInfo>;
  getChatStatus(): Promise<ChatStatus>;
  sendMessage(content: string): Promise<ChatStatus>;
  clearConversation(): Promise<ChatStatus>;
  cancelCurrentRequest(): Promise<ChatStatus>;
  /**
   * Reads a bundled character model. The renderer runs sandboxed with no file
   * access, and `fetch` is unavailable for `file://` URLs, so the bytes come
   * from the main process. Returns raw GLB bytes, never a filesystem path.
   */
  readCharacterAsset(id: CharacterAssetId): Promise<Uint8Array>;
}
