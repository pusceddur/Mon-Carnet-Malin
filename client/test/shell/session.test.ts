import {
  DEFAULT_EXERCISE_PREFERENCES, DEFAULT_PARENT_SETTINGS, DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES,
  type AuthStatus, type ChildProfile,
} from '@aide/shared';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api/http';
import { db } from '../../src/db/localDb';
import { createSessionStore, isParentUnlocked, SESSION_KV_KEYS, type SessionApi } from '../../src/state/session';

const NOW = 1_000_000;

function status(patch: Partial<AuthStatus> = {}): AuthStatus {
  return {
    setupRequired: false, authenticated: true, parent: { id: 'p1', email: 'parent@example.org', displayName: 'Parent', createdAt: 1, isOwner: true },
    parentUnlockedUntil: null, pinSet: true, pinLockedUntil: null, registrationOpen: false, ...patch,
  };
}

function child(id: string, patch: Partial<ChildProfile> = {}): ChildProfile {
  return {
    id, parentId: 'p1', firstName: `Enfant ${id}`, age: 9, avatar: '🐼', readingLevel: 'debutant', explanationDifficulty: 'tres_simple',
    reading: { ...DEFAULT_READING_PREFERENCES }, tts: { ...DEFAULT_TTS_PREFERENCES }, exercises: { ...DEFAULT_EXERCISE_PREFERENCES },
    createdAt: 1, updatedAt: 1, deletedAt: null, ...patch,
  };
}

function makeStore(opts: { online?: boolean; api?: Partial<SessionApi> } = {}) {
  const online = { value: opts.online ?? true };
  const api: SessionApi = {
    getAuthStatus: vi.fn(async () => status()),
    listChildren: vi.fn(async () => []),
    getSettings: vi.fn(async () => DEFAULT_PARENT_SETTINGS),
    listGlossary: vi.fn(async () => []),
    ...opts.api,
  };
  const applyRemote = vi.fn(async (_table: 'children', entities: ChildProfile[]) => {
    await db.children.bulkPut(entities);
  });
  const onSignedIn = vi.fn();
  const store = createSessionStore({ db, api, applyRemote, isOnline: () => online.value, now: () => NOW, onSignedIn });
  return { store, api, applyRemote, online, onSignedIn };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

afterAll(() => {
  db.close();
});

describe('isParentUnlocked', () => {
  it('requires an authenticated session with a future unlock time', () => {
    expect(isParentUnlocked(null, NOW)).toBe(false);
    expect(isParentUnlocked(status({ parentUnlockedUntil: NOW + 1 }), NOW)).toBe(true);
    expect(isParentUnlocked(status({ parentUnlockedUntil: NOW }), NOW)).toBe(false);
    expect(isParentUnlocked(status({ authenticated: false, parentUnlockedUntil: NOW + 1 }), NOW)).toBe(false);
  });
});

describe('session store', () => {
  it('starts offline from the cached session without calling the server', async () => {
    await db.kv.bulkPut([
      { key: SESSION_KV_KEYS.authStatus, value: status({ parentUnlockedUntil: NOW + 60_000 }) },
      { key: SESSION_KV_KEYS.selectedChildId, value: 'c1' },
      { key: SESSION_KV_KEYS.parentSettings, value: DEFAULT_PARENT_SETTINGS },
    ]);
    await db.children.bulkPut([child('c2', { createdAt: 5 }), child('c1', { createdAt: 2 }), child('gone', { deletedAt: 3 })]);
    const { store, api } = makeStore({ online: false });

    await store.getState().init();
    const s = store.getState();
    expect(api.getAuthStatus).not.toHaveBeenCalled();
    expect(s.ready).toBe(true);
    expect(s.online).toBe(false);
    expect(s.authStatus?.authenticated).toBe(true);
    expect(s.parentUnlocked).toBe(true);
    expect(s.selectedChildId).toBe('c1');
    expect(s.parentSettings).toEqual(DEFAULT_PARENT_SETTINGS);
    expect(s.children.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('is not ready without cache until the first server answer, then refreshes children, settings and glossary', async () => {
    const entry = { headword: 'volcan', partOfSpeech: 'nom' as const, kidDefinition: 'Une montagne qui crache du feu.', example: null };
    const { store, api, applyRemote } = makeStore({
      api: { listChildren: vi.fn(async () => [child('c1')]), listGlossary: vi.fn(async () => [entry]) },
    });
    await db.glossary.put({ headword: 'ancien', partOfSpeech: 'nom', kidDefinition: 'x', example: null });
    expect(store.getState().ready).toBe(false);

    await store.getState().init();
    expect(api.getAuthStatus).toHaveBeenCalledTimes(1);
    expect(applyRemote).toHaveBeenCalledWith('children', [expect.objectContaining({ id: 'c1' })]);
    const s = store.getState();
    expect(s.ready).toBe(true);
    expect(s.children.map((c) => c.id)).toEqual(['c1']);
    expect(s.parentSettings).toEqual(DEFAULT_PARENT_SETTINGS);
    expect((await db.kv.get(SESSION_KV_KEYS.authStatus))?.value).toMatchObject({ authenticated: true });
    expect((await db.kv.get(SESSION_KV_KEYS.parentSettings))?.value).toEqual(DEFAULT_PARENT_SETTINGS);
    expect((await db.glossary.toArray()).map((g) => g.headword)).toEqual(['volcan']);
  });

  it('init is idempotent', async () => {
    const { store, api } = makeStore();
    await Promise.all([store.getState().init(), store.getState().init()]);
    await store.getState().init();
    expect(api.getAuthStatus).toHaveBeenCalledTimes(1);
  });

  it('keeps the cached session when the server cannot be reached', async () => {
    await db.kv.put({ key: SESSION_KV_KEYS.authStatus, value: status() });
    const { store } = makeStore({ api: { getAuthStatus: vi.fn(async () => { throw new ApiError(0, 'offline', 'x'); }) } });
    await store.getState().init();
    expect(store.getState().authStatus?.authenticated).toBe(true);
    expect(store.getState().ready).toBe(true);
  });

  it('does not load children or settings when signed out', async () => {
    const { store, api } = makeStore({ api: { getAuthStatus: vi.fn(async () => status({ authenticated: false, parent: null })) } });
    await store.getState().init();
    expect(api.listChildren).not.toHaveBeenCalled();
    expect(store.getState().authStatus?.authenticated).toBe(false);
  });

  it('persists the selected child per device', async () => {
    const { store } = makeStore({ online: false });
    await store.getState().selectChild('c9');
    expect((await db.kv.get(SESSION_KV_KEYS.selectedChildId))?.value).toBe('c9');
    await store.getState().selectChild(null);
    expect(await db.kv.get(SESSION_KV_KEYS.selectedChildId)).toBeUndefined();
  });

  it('computes parentUnlocked and forgets the unlock on parent_locked', async () => {
    const { store } = makeStore({ online: false });
    await store.getState().setAuthStatus(status({ parentUnlockedUntil: NOW + 1_000 }));
    expect(store.getState().parentUnlocked).toBe(true);
    await store.getState().markParentLocked();
    expect(store.getState().parentUnlocked).toBe(false);
    expect(store.getState().authStatus?.parentUnlockedUntil).toBeNull();
    expect(((await db.kv.get(SESSION_KV_KEYS.authStatus))?.value as AuthStatus).parentUnlockedUntil).toBeNull();
  });

  it('starts a sync when the parent signs in after startup, not when the cached session is restored', async () => {
    await db.kv.put({ key: SESSION_KV_KEYS.authStatus, value: status() });
    const cached = makeStore();
    await cached.store.getState().init();
    expect(cached.onSignedIn).not.toHaveBeenCalled();

    const fresh = makeStore({ online: false });
    await fresh.store.getState().init();
    await fresh.store.getState().setAuthStatus(status({ authenticated: false, parent: null }));
    await fresh.store.getState().setAuthStatus(status());
    expect(fresh.onSignedIn).toHaveBeenCalledTimes(1);
    await fresh.store.getState().setAuthStatus(status({ parentUnlockedUntil: NOW + 5 }));
    expect(fresh.onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('markSignedOut keeps the local data but drops the authentication', async () => {
    await db.children.put(child('c1'));
    const { store } = makeStore({ online: false });
    await store.getState().setAuthStatus(status({ parentUnlockedUntil: NOW + 1_000 }));
    await store.getState().markSignedOut();
    expect(store.getState().authStatus).toMatchObject({ authenticated: false, parent: null, parentUnlockedUntil: null, setupRequired: false });
    expect(await db.children.count()).toBe(1);
  });

  it('wipes the local data of another family when a different parent signs in', async () => {
    const { store } = makeStore({ online: false });
    await store.getState().setAuthStatus(status());
    await db.children.put(child('c1'));
    await db.outbox.add({ table: 'children', entityId: 'c1', queuedAt: 1 } as never);
    await db.kv.put({ key: 'syncCursor', value: '12' });
    await db.kv.put({ key: 'deviceId', value: 'device' });
    await store.getState().selectChild('c1');

    await store.getState().setAuthStatus(status());
    expect(await db.children.count()).toBe(1);

    await store.getState().setAuthStatus(status({ parent: { id: 'p2', email: 'autre@example.org', displayName: 'Autre', createdAt: 1, isOwner: false } }));
    expect(await db.children.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.kv.get('syncCursor')).toBeUndefined();
    expect((await db.kv.get('deviceId'))?.value).toBe('device');
    expect(store.getState().selectedChildId).toBeNull();
    expect((await db.kv.get(SESSION_KV_KEYS.accountParentId))?.value).toBe('p2');
  });
});
