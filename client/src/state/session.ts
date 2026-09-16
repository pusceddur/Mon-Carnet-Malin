// STUB: client-shell
import type { AuthStatus, ChildProfile, Id, ParentSettings } from '@aide/shared';
import { create } from 'zustand';

export interface SessionState {
  authStatus: AuthStatus | null;          // null = not loaded yet
  selectedChildId: Id | null;
  children: ChildProfile[];
  parentSettings: ParentSettings | null;
  /** Loads cached state (Dexie kv) then refreshes from /api/auth/status when online. Never throws. */
  init(): Promise<void>;
  setAuthStatus(status: AuthStatus | null): void;
  selectChild(childId: Id | null): void;
  setChildren(children: ChildProfile[]): void;
  setParentSettings(settings: ParentSettings | null): void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  authStatus: null,
  selectedChildId: null,
  children: [],
  parentSettings: null,
  init: async () => {},
  setAuthStatus: (authStatus) => set({ authStatus }),
  selectChild: (selectedChildId) => set({ selectedChildId }),
  setChildren: (children) => set({ children }),
  setParentSettings: (parentSettings) => set({ parentSettings }),
}));

export function useSelectedChild(): ChildProfile | null {
  return useSessionStore((s) => s.children.find((c) => c.id === s.selectedChildId) ?? null);
}
