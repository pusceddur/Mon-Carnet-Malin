import type { AuthStatus, ChildProfile, GlossaryEntry, Id, Millis, ParentSettings } from '@aide/shared';
import { liveQuery } from 'dexie';
import { useEffect, useReducer } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { getAuthStatus } from '../api/auth';
import { listChildren } from '../api/children';
import { ApiError } from '../api/http';
import { listGlossary } from '../api/glossary';
import { getSettings } from '../api/settings';
import { db as defaultDb, type AideDb } from '../db/localDb';
import { applyRemote as defaultApplyRemote, syncNow } from '../sync/SyncEngine';

export const SESSION_KV_KEYS = {
  authStatus: 'authStatus',
  parentSettings: 'parentSettings',
  selectedChildId: 'selectedChildId',
  accountParentId: 'accountParentId',
} as const;

/** kv keys bound to the signed-in family, wiped when another parent account signs in on this device. */
const ACCOUNT_KV_KEYS = ['syncCursor', 'lastSyncAt', 'syncRestoreKeys', 'syncRejected', SESSION_KV_KEYS.selectedChildId, SESSION_KV_KEYS.parentSettings];

/** Refresh again when the app comes back to the foreground after this delay. */
const FOREGROUND_REFRESH_MS = 5 * 60_000;

export interface SessionState {
  /** Cached state loaded (and, without a cached session, the first server check settled). */
  ready: boolean;
  online: boolean;
  refreshing: boolean;
  authStatus: AuthStatus | null;          // null = unknown (no cache, server unreachable)
  selectedChildId: Id | null;
  /** Non-deleted children, oldest first (live from Dexie). */
  children: ChildProfile[];
  parentSettings: ParentSettings | null;
  /** parentUnlockedUntil is in the future (recomputed when it expires). */
  parentUnlocked: boolean;
  /** Loads cached state (Dexie kv) then refreshes from the server when online. Idempotent, never throws. */
  init(): Promise<void>;
  /** Server refresh: auth status, then children, settings and parent glossary when signed in. Never throws. */
  refresh(): Promise<void>;
  setAuthStatus(status: AuthStatus | null): Promise<void>;
  selectChild(childId: Id | null): Promise<void>;
  setChildren(children: ChildProfile[]): void;
  setParentSettings(settings: ParentSettings | null): Promise<void>;
  /** Server answered `parent_locked`: forget the unlock locally. */
  markParentLocked(): Promise<void>;
  /** Server answered `not_authenticated`: the guards send the parent back to the login page. */
  markSignedOut(): Promise<void>;
  /** §20 sign-out that also removes the books, pages and notes of the family from this device. */
  forgetThisDevice(): Promise<void>;
}

export interface SessionApi {
  getAuthStatus(): Promise<AuthStatus>;
  listChildren(): Promise<ChildProfile[]>;
  getSettings(): Promise<ParentSettings>;
  listGlossary(): Promise<GlossaryEntry[]>;
}

export interface SessionDeps {
  db: AideDb;
  api: SessionApi;
  applyRemote(table: 'children', entities: ChildProfile[]): Promise<void>;
  isOnline(): boolean;
  now(): Millis;
  window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  document?: Pick<Document, 'addEventListener' | 'visibilityState'>;
  /** Called when the session becomes authenticated (sign-in, setup): starts a sync right away. */
  onSignedIn?: () => void;
}

/** §20: an account that does not ask for the code has its Réglages always open. */
export function isParentUnlocked(status: AuthStatus | null, now: Millis): boolean {
  if (!status?.authenticated) return false;
  if (status.pinRequired === false) return true;
  return status.parentUnlockedUntil !== null && status.parentUnlockedUntil > now;
}

function sortChildren(children: ChildProfile[]): ChildProfile[] {
  return children.filter((c) => c.deletedAt === null).sort((a, b) => a.createdAt - b.createdAt || a.nickname.localeCompare(b.nickname, 'fr'));
}

export function createSessionStore(deps: SessionDeps): UseBoundStore<StoreApi<SessionState>> {
  const { db } = deps;
  let initPromise: Promise<void> | null = null;
  let refreshPromise: Promise<void> | null = null;
  let unlockTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRefreshAt = 0;

  const kvGet = async <T>(key: string): Promise<T | undefined> => {
    try {
      return (await db.kv.get(key))?.value as T | undefined;
    } catch {
      return undefined;
    }
  };
  const kvSet = async (key: string, value: unknown): Promise<void> => {
    try {
      if (value === null || value === undefined) await db.kv.delete(key);
      else await db.kv.put({ key, value });
    } catch {
      // Storage unavailable (private mode, quota): the in-memory state still works.
    }
  };

  const store = create<SessionState>()((set, get) => {
    function scheduleUnlockExpiry(status: AuthStatus | null): void {
      if (unlockTimer !== null) clearTimeout(unlockTimer);
      unlockTimer = null;
      const until = status?.parentUnlockedUntil ?? null;
      if (until === null || status?.pinRequired === false) return;
      const delay = until - deps.now();
      if (delay <= 0) return;
      unlockTimer = setTimeout(() => {
        unlockTimer = null;
        set({ parentUnlocked: isParentUnlocked(get().authStatus, deps.now()) });
      }, Math.min(delay + 50, 2_147_483_647));
    }

    async function reloadChildren(): Promise<void> {
      try {
        set({ children: sortChildren(await db.children.toArray()) });
      } catch {
        // Keep the current list.
      }
    }

    async function wipeAccountData(): Promise<void> {
      const tables = db.tables.filter((t) => t.name !== 'kv');
      await db.transaction('rw', tables, async () => {
        await Promise.all(tables.map((t) => t.clear()));
      });
      await db.kv.bulkDelete(ACCOUNT_KV_KEYS);
      set({ children: [], selectedChildId: null, parentSettings: null });
    }

    async function doRefresh(): Promise<void> {
      if (!deps.isOnline()) {
        set({ ready: true });
        return;
      }
      set({ refreshing: true });
      try {
        const status = await deps.api.getAuthStatus();
        lastRefreshAt = deps.now();
        await get().setAuthStatus(status);
        if (status.authenticated) {
          const [children, settings, glossary] = await Promise.allSettled([
            deps.api.listChildren(),
            deps.api.getSettings(),
            deps.api.listGlossary(),
          ]);
          if (children.status === 'fulfilled') {
            await deps.applyRemote('children', children.value);
            await reloadChildren();
          }
          if (settings.status === 'fulfilled') await get().setParentSettings(settings.value);
          if (glossary.status === 'fulfilled') {
            await db.transaction('rw', db.glossary, async () => {
              await db.glossary.clear();
              await db.glossary.bulkPut(glossary.value);
            });
          }
        }
      } catch (error) {
        if (error instanceof ApiError && error.code === 'not_authenticated') await get().markSignedOut();
        // Otherwise (offline, server down): keep the cached session.
      } finally {
        set({ refreshing: false, ready: true });
      }
    }

    async function doInit(): Promise<void> {
      const [authStatus, parentSettings, selectedChildId] = await Promise.all([
        kvGet<AuthStatus>(SESSION_KV_KEYS.authStatus),
        kvGet<ParentSettings>(SESSION_KV_KEYS.parentSettings),
        kvGet<Id>(SESSION_KV_KEYS.selectedChildId),
      ]);
      await reloadChildren();
      const status = authStatus ?? null;
      set({
        authStatus: status,
        parentSettings: parentSettings ?? null,
        selectedChildId: selectedChildId ?? null,
        parentUnlocked: isParentUnlocked(status, deps.now()),
        online: deps.isOnline(),
        // Offline-first: a cached session is usable right away; without cache, wait for the first server answer.
        ready: status !== null || !deps.isOnline(),
      });
      scheduleUnlockExpiry(status);

      try {
        liveQuery(() => db.children.toArray()).subscribe({
          next: (rows) => set({ children: sortChildren(rows) }),
          error: () => undefined,
        });
      } catch {
        // liveQuery unavailable: explicit reloads still keep the list fresh.
      }

      deps.window?.addEventListener('online', () => {
        set({ online: true });
        void get().refresh();
      });
      deps.window?.addEventListener('offline', () => set({ online: false }));
      deps.document?.addEventListener('visibilitychange', () => {
        if (deps.document?.visibilityState !== 'visible') return;
        set({ parentUnlocked: isParentUnlocked(get().authStatus, deps.now()) });
        if (deps.now() - lastRefreshAt > FOREGROUND_REFRESH_MS) void get().refresh();
      });

      await get().refresh();
    }

    return {
      ready: false,
      online: deps.isOnline(),
      refreshing: false,
      authStatus: null,
      selectedChildId: null,
      children: [],
      parentSettings: null,
      parentUnlocked: false,

      init: () => {
        initPromise ??= doInit().catch(() => {
          set({ ready: true });
        });
        return initPromise;
      },

      refresh: () => {
        refreshPromise ??= doRefresh().finally(() => {
          refreshPromise = null;
        });
        return refreshPromise;
      },

      setAuthStatus: async (status) => {
        if (status?.authenticated && status.parent) {
          const previous = await kvGet<Id>(SESSION_KV_KEYS.accountParentId);
          if (previous !== undefined && previous !== status.parent.id) {
            try {
              await wipeAccountData();
            } catch {
              // Best effort: the server still rejects rows of another family.
            }
          }
          await kvSet(SESSION_KV_KEYS.accountParentId, status.parent.id);
        }
        const wasSignedIn = get().authStatus?.authenticated === true;
        await kvSet(SESSION_KV_KEYS.authStatus, status);
        set({ authStatus: status, parentUnlocked: isParentUnlocked(status, deps.now()) });
        scheduleUnlockExpiry(status);
        if (status?.authenticated && !wasSignedIn && get().ready) deps.onSignedIn?.();
      },

      selectChild: async (childId) => {
        set({ selectedChildId: childId });
        await kvSet(SESSION_KV_KEYS.selectedChildId, childId);
      },

      setChildren: (children) => set({ children: sortChildren(children) }),

      setParentSettings: async (settings) => {
        set({ parentSettings: settings });
        await kvSet(SESSION_KV_KEYS.parentSettings, settings);
      },

      markParentLocked: async () => {
        const status = get().authStatus;
        // §20: without the code the adult area never locks.
        if (!status || status.parentUnlockedUntil === null || !status.pinRequired) return;
        await get().setAuthStatus({ ...status, parentUnlockedUntil: null });
      },

      forgetThisDevice: async () => {
        await wipeAccountData();
        await db.kv.delete(SESSION_KV_KEYS.accountParentId);
        await get().markSignedOut();
      },

      markSignedOut: async () => {
        const status = get().authStatus;
        await get().setAuthStatus({
          setupRequired: false,
          pinSet: status?.pinSet ?? true,
          pinLockedUntil: status?.pinLockedUntil ?? null,
          registrationOpen: status?.registrationOpen ?? false,
          pinRequired: status?.pinRequired ?? true,
          passwordResetAvailable: status?.passwordResetAvailable ?? false,
          aiReading: status?.aiReading ?? false,
          ...status,
          authenticated: false,
          parent: null,
          parentUnlockedUntil: null,
        });
      },
    };
  });

  return store;
}

export const useSessionStore = createSessionStore({
  db: defaultDb,
  api: { getAuthStatus, listChildren, getSettings, listGlossary },
  applyRemote: (table, entities) => defaultApplyRemote(table, entities),
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  now: () => Date.now(),
  window: typeof window === 'undefined' ? undefined : window,
  document: typeof document === 'undefined' ? undefined : document,
  onSignedIn: () => void syncNow(),
});

export function useSelectedChild(): ChildProfile | null {
  return useSessionStore((s) => s.children.find((c) => c.id === s.selectedChildId) ?? null);
}

/** True while the parent area is unlocked; re-renders when the unlock expires. */
export function useParentUnlocked(): boolean {
  const until = useSessionStore((s) => (s.authStatus?.authenticated ? s.authStatus.parentUnlockedUntil : null));
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (until === null) return undefined;
    const delay = until - Date.now();
    if (delay <= 0) return undefined;
    const timer = setTimeout(forceRender, Math.min(delay + 50, 2_147_483_647));
    const onVisible = (): void => forceRender();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [until]);
  return until !== null && until > Date.now();
}
