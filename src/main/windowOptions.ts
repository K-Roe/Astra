import type { BrowserWindowConstructorOptions } from 'electron';

export function createWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#100d19',
    title: 'ASTRA',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  };
}
