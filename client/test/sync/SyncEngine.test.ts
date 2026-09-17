import {
  DEFAULT_EXERCISE_PREFERENCES, DEFAULT_PARENT_SETTINGS, DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES,
  type ChildProfile, type DocumentMeta, type PageContent, type SyncChanges, type SyncRequest, type SyncResponse, type TextHighlight,
} from '@aide/shared';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api/http';
import { db } from '../../src/db/localDb';
import {
  computeBackoffMs, createSyncEngine, emptyChanges, primaryKeyFromEntityKey, SYNC_KV_KEYS, type SyncEngine, type SyncEngineDeps,
  type SyncStatus,
} from '../../src/sync/SyncEngine';

const PARENT = 'parent-1';

function doc(id: string, updatedAt: number, patch: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    id, ownerParentId: PARENT, childIds: ['child-1'], title: `Livre ${id}`, kind: 'pdf', sourceHash: 'a'.repeat(64), pageCount: 2,
    status: 'ready', createdAt: 1, updatedAt, deletedAt: null, ...patch,
  };
}

function page(documentId: string, pageIndex: number, updatedAt: number, patch: Partial<PageContent> = {}): PageContent {
  return {
    documentId, pageIndex, status: 'ready', textSource: 'pdf-text', blocks: [{ kind: 'paragraph', text: 'Le chat dort.' }],
    confidence: null, contentHash: 'b'.repeat(64), width: null, height: null, warnings: [], updatedAt, ...patch,
  };
}

function highlight(id: string, updatedAt: number): TextHighlight {
  return {
    id, type: 'highlight', childId: 'child-1', documentId: 'doc-1', color: '#fde047', pageIndex: 0, blockIndex: 0, start: 0, end: 2,
    blockTextHash: 'c'.repeat(64), text: 'Le', createdAt: 1, updatedAt, deletedAt: null,
  };
}

function child(id: string, updatedAt: number): ChildProfile {
  return {
    id, parentId: PARENT, firstName: 'Léa', age: 10, avatar: '🦊', readingLevel: 'intermediaire', explanationDifficulty: 'simple',
    reading: { ...DEFAULT_READING_PREFERENCES }, tts: { ...DEFAULT_TTS_PREFERENCES }, exercises: { ...DEFAULT_EXERCISE_PREFERENCES },
    createdAt: 1, updatedAt, deletedAt: null,
  };
}

function response(patch: Partial<SyncResponse> = {}, changes: Partial<SyncChanges> = {}): SyncResponse {
  return { cursor: '1', hasMore: false, serverTime: 1000, changes: { ...emptyChanges(), ...changes }, rejected: [], ...patch };
}

interface Harness {
  engine: SyncEngine;
  send: ReturnType<typeof vi.fn<(req: SyncRequest) => Promise<SyncResponse>>>;
  online: { value: boolean };
  timers: { fn: () => void; ms: number }[];
}

function harness(handler: (req: SyncRequest, call: number) => Promise<SyncResponse> | SyncResponse, extra: Partial<SyncEngineDeps> = {}): Harness {
  let call = 0;
  const send = vi.fn(async (req: SyncRequest) => handler(structuredClone(req), call++));
  const online = { value: true };
  const timers: { fn: () => void; ms: number }[] = [];
  const engine = createSyncEngine({
    db,
    send,
    isOnline: () => online.value,
    now: () => 5_000,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => {},
    ...extra,
  });
  return { engine, send, online, timers };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

afterAll(() => {
  db.close();
});

describe('SyncEngine helpers', () => {
  it('computes an exponential backoff capped at 5 minutes', () => {
    expect(computeBackoffMs(0)).toBe(0);
    expect(computeBackoffMs(1)).toBe(5_000);
    expect(computeBackoffMs(2)).toBe(10_000);
    expect(computeBackoffMs(4)).toBe(40_000);
    expect(computeBackoffMs(30)).toBe(300_000);
  });

  it('maps entity keys back to Dexie primary keys', () => {
    expect(primaryKeyFromEntityKey('pages', 'doc-1:12')).toEqual(['doc-1', 12]);
    expect(primaryKeyFromEntityKey('progress', 'child-1:doc-1')).toEqual(['child-1', 'doc-1']);
    expect(primaryKeyFromEntityKey('annotations', 'a1')).toBe('a1');
    expect(primaryKeyFromEntityKey('pages', 'broken')).toBeNull();
  });
});

describe('saveEntity / applyRemote', () => {
  it('saveEntity writes Dexie and keeps a single outbox row per entity', async () => {
    const { engine } = harness(() => response());
    await engine.saveEntity('documents', doc('doc-1', 10));
    await engine.saveEntity('documents', doc('doc-1', 11));
    await engine.saveEntity('pages', page('doc-1', 0, 10));
    expect((await db.documents.get('doc-1'))?.updatedAt).toBe(11);
    const outbox = await db.outbox.toArray();
    expect(outbox.map((r) => [r.table, r.entityId])).toEqual([['documents', 'doc-1'], ['pages', 'doc-1:0']]);
    expect(engine.getStatus().pending).toBe(2);
  });

  it('applyRemote never writes to the outbox (no bounce) and applies local LWW', async () => {
    const { engine } = harness(() => response());
    await db.documents.put(doc('doc-1', 20, { title: 'local' }));
    await engine.applyRemote('documents', [
      doc('doc-1', 19, { title: 'older' }),
      doc('doc-2', 5, { title: 'new' }),
    ]);
    expect((await db.documents.get('doc-1'))?.title).toBe('local');
    await engine.applyRemote('documents', [doc('doc-1', 20, { title: 'same time' })]);
    expect((await db.documents.get('doc-1'))?.title).toBe('local');
    await engine.applyRemote('documents', [doc('doc-1', 21, { title: 'newer' })]);
    expect((await db.documents.get('doc-1'))?.title).toBe('newer');
    expect((await db.documents.get('doc-2'))?.title).toBe('new');
    expect(await db.outbox.count()).toBe(0);
  });

  it('keeps local page text when a remote page arrives without text but with the same content', async () => {
    const { engine } = harness(() => response());
    await db.pages.put(page('doc-1', 0, 10));
    await engine.applyRemote('pages', [page('doc-1', 0, 11, { blocks: [], status: 'low_confidence' })]);
    const stored = await db.pages.get(['doc-1', 0]);
    expect(stored?.status).toBe('low_confidence');
    expect(stored?.blocks).toHaveLength(1);
  });
});

describe('syncNow', () => {
  it('pushes the outbox in table order, persists cursor/deviceId and clears the outbox', async () => {
    const { engine, send } = harness(() => response({ cursor: '42' }));
    await engine.saveEntity('pages', page('doc-1', 0, 10));
    await engine.saveEntity('documents', doc('doc-1', 10));
    await engine.syncNow();

    expect(send).toHaveBeenCalledTimes(1);
    const req = send.mock.calls[0]?.[0] as SyncRequest;
    expect(req.cursor).toBeNull();
    expect(req.changes.documents.map((d) => d.id)).toEqual(['doc-1']);
    expect(req.changes.pages).toHaveLength(1);
    expect(typeof req.deviceId).toBe('string');
    expect(await db.outbox.count()).toBe(0);
    expect((await db.kv.get(SYNC_KV_KEYS.cursor))?.value).toBe('42');
    expect((await db.kv.get(SYNC_KV_KEYS.deviceId))?.value).toBe(req.deviceId);
    expect(engine.getStatus()).toMatchObject({ state: 'idle', pending: 0, lastError: null, lastSyncAt: 5_000 });

    await engine.syncNow();
    const second = send.mock.calls[1]?.[0] as SyncRequest;
    expect(second.cursor).toBe('42');
    expect(second.deviceId).toBe(req.deviceId);
  });

  it('keeps the outbox row when the entity changed while the request was in flight', async () => {
    let engineRef: SyncEngine | null = null;
    const { engine } = harness(async (req, call) => {
      if (call === 0) {
        expect(req.changes.annotations[0]?.updatedAt).toBe(10);
        await engineRef?.saveEntity('annotations', highlight('h1', 11));
      }
      return response({ cursor: String(call + 1) });
    });
    engineRef = engine;
    await engine.saveEntity('annotations', highlight('h1', 10));
    await engine.saveEntity('annotations', highlight('h2', 10));
    await engine.syncNow();

    const rows = await db.outbox.toArray();
    expect(rows.map((r) => r.entityId)).toEqual(['h1']);
    await engine.syncNow();
    expect(await db.outbox.count()).toBe(0);
  });

  it('pulls every page while hasMore and applies remote changes without outbox rows', async () => {
    const { engine, send } = harness((req, call) => {
      expect(req.cursor).toBe(call === 0 ? null : String(call));
      if (call === 0) return response({ cursor: '1', hasMore: true }, { documents: [doc('r1', 3)] });
      if (call === 1) return response({ cursor: '2', hasMore: true }, { pages: [page('r1', 0, 3)] });
      return response({ cursor: '3', hasMore: false }, { children: [child('c1', 3)] });
    });
    await engine.syncNow();
    expect(send).toHaveBeenCalledTimes(3);
    expect(await db.documents.get('r1')).toBeDefined();
    expect(await db.pages.get(['r1', 0])).toBeDefined();
    expect(await db.children.get('c1')).toBeDefined();
    expect(await db.outbox.count()).toBe(0);
    expect((await db.kv.get(SYNC_KV_KEYS.cursor))?.value).toBe('3');
  });

  it('splits a large outbox into batches, documents before pages', async () => {
    const { engine, send } = harness((_req, call) => response({ cursor: String(call + 1) }), { maxBatchEntities: 2 });
    await engine.saveEntity('pages', page('doc-1', 0, 1));
    await engine.saveEntity('pages', page('doc-1', 1, 1));
    await engine.saveEntity('documents', doc('doc-1', 1));
    await engine.syncNow();
    expect(send).toHaveBeenCalledTimes(2);
    const first = send.mock.calls[0]?.[0] as SyncRequest;
    const second = send.mock.calls[1]?.[0] as SyncRequest;
    expect(first.changes.documents).toHaveLength(1);
    expect(first.changes.pages.map((p) => p.pageIndex)).toEqual([0]);
    expect(second.cursor).toBe('1');
    expect(second.changes.pages.map((p) => p.pageIndex)).toEqual([1]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('does nothing while offline and reports the offline state', async () => {
    const { engine, send, online } = harness(() => response());
    online.value = false;
    await engine.saveEntity('documents', doc('doc-1', 1));
    const states: SyncStatus[] = [];
    engine.subscribeSync((s) => states.push(s));
    await engine.syncNow();
    expect(send).not.toHaveBeenCalled();
    expect(engine.getStatus()).toMatchObject({ state: 'offline', pending: 1 });
    expect(states[0]?.state).toBe('idle');
    expect(await db.outbox.count()).toBe(1);
  });

  it('skips the request when the cached session says the parent is signed out', async () => {
    const { engine, send } = harness(() => response());
    await db.kv.put({ key: SYNC_KV_KEYS.authStatus, value: { authenticated: false } });
    await engine.syncNow();
    expect(send).not.toHaveBeenCalled();
    expect(engine.getStatus().state).toBe('idle');
  });

  it('reports errors, keeps the outbox and schedules a retry with backoff once started', async () => {
    const { engine, timers } = harness(() => {
      throw new ApiError(500, 'http_error', 'HTTP 500');
    });
    const stop = engine.startSync();
    await engine.syncNow();
    await engine.saveEntity('documents', doc('doc-1', 1));
    await engine.syncNow();
    expect(engine.getStatus()).toMatchObject({ state: 'error', lastError: 'http_error', pending: 1 });
    expect(timers.some((t) => t.ms === computeBackoffMs(2))).toBe(true);
    stop();
  });

  it('treats network failures as offline (no error message)', async () => {
    const { engine } = harness(() => {
      throw new ApiError(0, 'offline', 'offline');
    });
    await engine.syncNow();
    expect(engine.getStatus()).toMatchObject({ state: 'offline', lastError: null });
  });

  it('does not push annotations when the parent disabled annotation sync, and strips page text when asked', async () => {
    const settings = { ...DEFAULT_PARENT_SETTINGS, privacy: { ...DEFAULT_PARENT_SETTINGS.privacy, syncAnnotations: false, syncDocumentText: false } };
    await db.kv.put({ key: SYNC_KV_KEYS.parentSettings, value: settings });
    const { engine, send } = harness(() => response());
    await engine.saveEntity('annotations', highlight('h1', 1));
    await engine.saveEntity('pages', page('doc-1', 0, 1));
    await engine.syncNow();
    const req = send.mock.calls[0]?.[0] as SyncRequest;
    expect(req.changes.annotations).toHaveLength(0);
    expect(req.changes.pages[0]?.blocks).toEqual([]);
    expect((await db.pages.get(['doc-1', 0]))?.blocks).toHaveLength(1);
    expect((await db.outbox.toArray()).map((r) => r.table)).toEqual(['annotations']);
  });

  it('drops rejected rows, logs them and restores the server copy with a full pull', async () => {
    const serverDoc = doc('doc-1', 5, { title: 'serveur', deletedAt: null });
    const { engine, send } = harness((req, call) => {
      if (call === 0) {
        expect(req.changes.documents[0]?.deletedAt).toBe(50);
        return response({ cursor: '9', rejected: [{ table: 'documents', entityKey: 'doc-1', reason: 'parent_locked' }] });
      }
      expect(req.cursor).toBeNull();
      return response({ cursor: '10' }, { documents: [serverDoc] });
    });
    await db.kv.put({ key: SYNC_KV_KEYS.cursor, value: '8' });
    await engine.saveEntity('documents', doc('doc-1', 50, { deletedAt: 50 }));
    await engine.syncNow();

    expect(send).toHaveBeenCalledTimes(2);
    const restored = await db.documents.get('doc-1');
    expect(restored?.deletedAt).toBeNull();
    expect(restored?.title).toBe('serveur');
    expect(await db.outbox.count()).toBe(0);
    expect((await db.kv.get(SYNC_KV_KEYS.cursor))?.value).toBe('10');
    expect(await db.kv.get(SYNC_KV_KEYS.restoreKeys)).toBeUndefined();
    const log = await engine.getLastRejections();
    expect(log?.items).toEqual([{ table: 'documents', entityKey: 'doc-1', reason: 'parent_locked' }]);
  });

  it('coalesces concurrent calls into one in-flight request plus one follow-up', async () => {
    let release: (() => void) | null = null;
    const { engine, send } = harness(async (_req, call) => {
      if (call === 0) await new Promise<void>((resolve) => { release = resolve; });
      return response({ cursor: String(call + 1) });
    });
    const a = engine.syncNow();
    const b = engine.syncNow();
    const c = engine.syncNow();
    await vi.waitFor(() => expect(release).not.toBeNull());
    (release as unknown as () => void)();
    await Promise.all([a, b, c]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('pending counts per table and the subscription reflect the outbox', async () => {
    const { engine } = harness(() => response());
    await engine.saveEntity('annotations', highlight('h1', 1));
    await engine.saveEntity('annotations', highlight('h2', 1));
    await engine.saveEntity('progress', { childId: 'child-1', documentId: 'doc-1', pageIndex: 1, blockIndex: 0, sentenceIndex: 0, updatedAt: 1 });
    const counts = await engine.getPendingCounts();
    expect(counts.annotations).toBe(2);
    expect(counts.progress).toBe(1);
    expect(counts.documents).toBe(0);
    const seen: number[] = [];
    const unsubscribe = engine.subscribeSync((s) => seen.push(s.pending));
    await vi.waitFor(() => expect(seen).toContain(3));
    unsubscribe();
  });
});
