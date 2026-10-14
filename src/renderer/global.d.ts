import type { AstraBridge } from '../shared/contracts';
import type { IntelligenceBridge } from '../shared/intelligence';

declare global {
  interface Window {
    astra: AstraBridge;
    /**
     * Intelligence services. Separate from `astra` so chat can evolve without
     * the coding and knowledge surface changing, but exposed by the same
     * sandboxed preload with the same primary-frame checks.
     */
    astraIntelligence: IntelligenceBridge;
  }
}

export {};
