import { create } from 'zustand';

export interface RegisterSwOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisterError?: (error: unknown) => void;
}

export type RegisterSw = (options: RegisterSwOptions) => (reloadPage?: boolean) => Promise<void>;

export interface PwaState {
  /** A new version is waiting: it activates when the app restarts, or now with `applyUpdate`. */
  needRefresh: boolean;
  offlineReady: boolean;
  applyUpdate(): Promise<void>;
  dismissUpdate(): void;
}

let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;
let registered = false;

export const usePwaStore = create<PwaState>()((set) => ({
  needRefresh: false,
  offlineReady: false,
  applyUpdate: async () => {
    set({ needRefresh: false });
    await updateServiceWorker?.(true);
  },
  dismissUpdate: () => set({ needRefresh: false }),
}));

/** Registers the service worker once (prompt mode: never reloads the page by itself, e.g. during OCR or reading). */
export function registerPwa(register: RegisterSw): void {
  if (registered || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  registered = true;
  try {
    updateServiceWorker = register({
      immediate: true,
      onNeedRefresh: () => usePwaStore.setState({ needRefresh: true }),
      onOfflineReady: () => usePwaStore.setState({ offlineReady: true }),
      onRegisterError: () => undefined,
    });
  } catch {
    // Insecure context (plain http on the LAN) or blocked service workers: the app still works online.
  }
}
