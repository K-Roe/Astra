import type { AstraBridge } from '../shared/contracts';

declare global {
  interface Window {
    astra: AstraBridge;
  }
}

export {};
