import {
  newId, syncEntityKey, TIMINGS,
  type Millis, type PageContent, type ParentSettings, type SyncChanges, type SyncEntity, type SyncRejection, type SyncRequest,
  type SyncResponse, type SyncTable,
} from '@aide/shared';
import type { IndexableType, Table } from 'dexie';
import { ApiError } from '../api/http';
import { postSync } from '../api/sync';
import { db as defaultDb, type AideDb, type OutboxRecord } from '../db/localDb';

export interface SyncStatus { state: 'idle' | 'syncing' | 'error' | 'offline'; lastSyncAt: Millis | null; pending: number; lastError: string | null }

/** Push/apply order (§15.2): parents before the rows that reference them. */
export const SYNC_TABLE_ORDER: readonly SyncTable[] = ['children', 'documents', 'pages', 'exercises', 'annotations', 'answers', 'progress', 'sessions'];

export const SYNC_KV_KEYS = {
  deviceId: 'deviceId',
  cursor: 'syncCursor',
  lastSyncAt: 'lastSyncAt',
  restoreKeys: 'syncRestoreKeys',
  rejected: 'syncRejected',
  authStatus: 'authStatus',
  parentSettings: 'parentSettings',
} as const;

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const DEFAULT_MAX_BATCH_CHARS = 4_000_000;   // well under the 25 MB body limit, even with multi-byte text
const DEFAULT_MAX_BATCH_ENTITIES = 1_000;
const MAX_ROUNDS = 500;
const MAX_LOGGED_REJECTIONS = 50;

/** Last rejections returned by the server (kv `syncRejected`), newest first. */
export interface SyncRejectionLog { at: Millis; items: SyncRejection[] }

/** Delay before the n-th consecutive retry (1-based): 5 s, 10 s, 20 s … capped at 5 min. */
export function computeBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 16));
}

export function emptyChanges(): SyncChanges {
  return { documents: [], pages: [], annotations: [], progress: [], sessions: [], exercises: [], answers: [], children: [] };
}

function isSyncTable(value: string): value is SyncTable {
  return (SYNC_TABLE_ORDER as readonly string[]).includes(value);
}

/** Dexie primary key of a syncable entity (compound for pages and progress). */
export function primaryKeyOf<T extends SyncTable>(table: T, entity: SyncEntity<T>): IndexableType {
  const e: SyncEntity<SyncTable> = entity;
  if (table === 'pages') {
    const page = e as PageContent;
    return [page.documentId, page.pageIndex];
  }
  if (table === 'progress') {
    const progress = e as SyncEntity<'progress'>;
    return [progress.childId, progress.documentId];
  }
  return (e as { id: string }).id;
}

/** Inverse of syncEntityKey for Dexie lookups. */
export function primaryKeyFromEntityKey(table: SyncTable, entityKey: string): IndexableType | null {
  if (table === 'pages') {
    const i = entityKey.lastIndexOf(':');
    const pageIndex = Number(entityKey.slice(i + 1));
    if (i <= 0 || !Number.isInteger(pageIndex)) return null;
    return [entityKey.slice(0, i), pageIndex];
  }
  if (table === 'progress') {
    const i = entityKey.indexOf(':');
    if (i <= 0 || i === entityKey.length - 1) return null;
    return [entityKey.slice(0, i), entityKey.slice(i + 1)];
  }
  return entityKey === '' ? null : entityKey;
}

const restoreId = (table: SyncTable, entityKey: string): string => `${table}|${entityKey}`;

interface BatchItem { table: SyncTable; entityKey: string; primaryKey: IndexableType; updatedAt: Millis; seqs: number[] }
interface Batch { changes: SyncChanges; items: BatchItem[]; size: number; hasMore: boolean }

export interface SyncEngineDeps {
  db: AideDb;
  send(req: SyncRequest, signal?: AbortSignal): Promise<SyncResponse>;
  isOnline(): boolean;
  now(): Millis;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Window/document for the `online` and `visibilitychange` listeners (undefined outside a browser). */
  events?: { window?: Pick<Window, 'addEventListener' | 'removeEventListener'>; document?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> };
  maxBatchChars?: number;
  maxBatchEntities?: number;
}

export interface SyncEngine {
  saveEntity<T extends SyncTable>(table: T, entity: SyncEntity<T>): Promise<void>;
  applyRemote<T extends SyncTable>(table: T, entities: SyncEntity<T>[]): Promise<void>;
  syncNow(): Promise<void>;
  startSync(): () => void;
  subscribeSync(cb: (s: SyncStatus) => void): () => void;
  getStatus(): SyncStatus;
  getPendingCounts(): Promise<Record<SyncTable, number>>;
  getDeviceId(): Promise<string>;
  getLastRejections(): Promise<SyncRejectionLog | null>;
}

type AnyTable = Table<SyncEntity<SyncTable>, IndexableType>;

function isSyncResponse(value: unknown): value is SyncResponse {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<SyncResponse>;
  return typeof r.cursor === 'string' && typeof r.hasMore === 'boolean' && typeof r.changes === 'object' && r.changes !== null;
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { db } = deps;
  const maxChars = deps.maxBatchChars ?? DEFAULT_MAX_BATCH_CHARS;
  const maxEntities = deps.maxBatchEntities ?? DEFAULT_MAX_BATCH_ENTITIES;

  let status: SyncStatus = { state: 'idle', lastSyncAt: null, pending: 0, lastError: null };
  const listeners = new Set<(s: SyncStatus) => void>();
  let initPromise: Promise<void> | null = null;
  let inFlight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let failures = 0;
  let nextRetryAt = 0;
  let startCount = 0;
  let retryTimer: unknown = null;
  let debounceTimer: unknown = null;
  let intervalTimer: unknown = null;

  const table = (name: SyncTable): AnyTable => db.table(name) as AnyTable;

  function update(patch: Partial<SyncStatus>): void {
    status = { ...status, ...patch };
    const snapshot = { ...status };
    for (const listener of Array.from(listeners)) {
      try {
        listener(snapshot);
      } catch {
        // A faulty listener must not break the engine.
      }
    }
  }

  async function kvGet<T>(key: string): Promise<T | undefined> {
    return (await db.kv.get(key))?.value as T | undefined;
  }

  async function countPending(): Promise<number> {
    try {
      return await db.outbox.count();
    } catch {
      return status.pending;
    }
  }

  function ensureInit(): Promise<void> {
    initPromise ??= (async () => {
      try {
        const lastSyncAt = await kvGet<number>(SYNC_KV_KEYS.lastSyncAt);
        update({ lastSyncAt: typeof lastSyncAt === 'number' ? lastSyncAt : null, pending: await countPending() });
      } catch {
        // Storage unavailable: keep defaults.
      }
    })();
    return initPromise;
  }

  async function getDeviceId(): Promise<string> {
    const existing = await kvGet<string>(SYNC_KV_KEYS.deviceId);
    if (typeof existing === 'string' && existing !== '') return existing;
    const id = newId();
    await db.kv.put({ key: SYNC_KV_KEYS.deviceId, value: id });
    return id;
  }

  // ---------- local writes ----------

  async function saveEntity<T extends SyncTable>(tableName: T, entity: SyncEntity<T>): Promise<void> {
    const entityKey = syncEntityKey(tableName, entity);
    await db.transaction('rw', table(tableName), db.outbox, async () => {
      await table(tableName).put(entity);
      // One outbox row per entity is enough: the row is only removed once the pushed updatedAt is still current.
      const existing = await db.outbox.where('entityId').equals(entityKey).filter((r) => r.table === tableName).first();
      if (!existing) await db.outbox.add({ table: tableName, entityId: entityKey, queuedAt: deps.now() } as OutboxRecord);
    });
    update({ pending: await countPending() });
    scheduleDebounced();
  }

  async function applyRemoteInternal<T extends SyncTable>(tableName: T, entities: SyncEntity<T>[], force?: ReadonlySet<string>): Promise<void> {
    if (entities.length === 0) return;
    // Keep the newest copy when the same entity appears twice.
    const byKey = new Map<string, SyncEntity<T>>();
    for (const entity of entities) {
      const key = syncEntityKey(tableName, entity);
      const previous = byKey.get(key);
      if (!previous || entity.updatedAt >= previous.updatedAt) byKey.set(key, entity);
    }
    const t = table(tableName);
    await db.transaction('rw', t, async () => {
      const list = Array.from(byKey.entries());
      const existing = await t.bulkGet(list.map(([, e]) => primaryKeyOf(tableName, e)));
      const toPut: SyncEntity<SyncTable>[] = [];
      list.forEach(([key, remote], i) => {
        const local = existing[i];
        const forced = force?.has(restoreId(tableName, key)) === true;
        if (local && !forced && remote.updatedAt <= local.updatedAt) return;
        toPut.push(local && tableName === 'pages' ? keepLocalText(remote as PageContent, local as PageContent) : remote);
      });
      if (toPut.length > 0) await t.bulkPut(toPut);
    });
  }

  function applyRemote<T extends SyncTable>(tableName: T, entities: SyncEntity<T>[]): Promise<void> {
    return applyRemoteInternal(tableName, entities);
  }

  // ---------- push ----------

  async function collectBatch(settings: ParentSettings | undefined): Promise<Batch> {
    const rows = await db.outbox.orderBy('seq').toArray();
    const groups = new Map<string, { table: SyncTable; entityKey: string; seqs: number[]; firstSeq: number }>();
    const invalidSeqs: number[] = [];
    for (const row of rows) {
      if (!isSyncTable(row.table)) {
        invalidSeqs.push(row.seq);
        continue;
      }
      const id = restoreId(row.table, row.entityId);
      const group = groups.get(id);
      if (group) group.seqs.push(row.seq);
      else groups.set(id, { table: row.table, entityKey: row.entityId, seqs: [row.seq], firstSeq: row.seq });
    }

    const changes = emptyChanges();
    const items: BatchItem[] = [];
    let size = 0;
    let hasMore = false;

    outer: for (const tableName of SYNC_TABLE_ORDER) {
      if (tableName === 'annotations' && settings?.privacy.syncAnnotations === false) continue;
      const tableGroups = Array.from(groups.values()).filter((g) => g.table === tableName).sort((a, b) => a.firstSeq - b.firstSeq);
      if (tableGroups.length === 0) continue;
      const keys = tableGroups.map((g) => primaryKeyFromEntityKey(tableName, g.entityKey));
      const entities = await table(tableName).bulkGet(keys.filter((k): k is IndexableType => k !== null));
      let cursor = 0;
      for (let i = 0; i < tableGroups.length; i += 1) {
        const group = tableGroups[i] as (typeof tableGroups)[number];
        const key = keys[i];
        const entity = key === null || key === undefined ? undefined : entities[cursor++];
        if (!entity) {
          invalidSeqs.push(...group.seqs);
          continue;
        }
        const payload = tableName === 'pages' && settings?.privacy.syncDocumentText === false
          ? { ...(entity as PageContent), blocks: [] }
          : entity;
        const entitySize = JSON.stringify(payload).length;
        if (items.length > 0 && (size + entitySize > maxChars || items.length >= maxEntities)) {
          hasMore = true;
          break outer;
        }
        (changes[tableName] as SyncEntity<SyncTable>[]).push(payload);
        items.push({ table: tableName, entityKey: group.entityKey, primaryKey: key as IndexableType, updatedAt: entity.updatedAt, seqs: group.seqs });
        size += entitySize;
      }
    }

    if (invalidSeqs.length > 0) await db.outbox.bulkDelete(invalidSeqs);
    return { changes, items, size, hasMore };
  }

  /** Removes pushed outbox rows whose entity is still at the pushed updatedAt. Returns the keys that changed meanwhile. */
  async function settleOutbox(items: BatchItem[]): Promise<Set<string>> {
    const changed = new Set<string>();
    if (items.length === 0) return changed;
    const tables = Array.from(new Set(items.map((i) => i.table))).map(table);
    await db.transaction('rw', [db.outbox, ...tables], async () => {
      for (const item of items) {
        const current = await table(item.table).get(item.primaryKey);
        if (current && current.updatedAt !== item.updatedAt) {
          changed.add(restoreId(item.table, item.entityKey));
          continue;
        }
        await db.outbox.bulkDelete(item.seqs);
      }
    });
    return changed;
  }

  // ---------- sync loop ----------

  async function logRejections(rejected: SyncRejection[]): Promise<void> {
    const previous = await kvGet<SyncRejectionLog>(SYNC_KV_KEYS.rejected);
    const items = [...rejected, ...(previous?.items ?? [])].slice(0, MAX_LOGGED_REJECTIONS);
    await db.kv.put({ key: SYNC_KV_KEYS.rejected, value: { at: deps.now(), items } satisfies SyncRejectionLog });
  }

  async function isSignedOut(): Promise<boolean> {
    const auth = await kvGet<{ authenticated?: boolean } | null>(SYNC_KV_KEYS.authStatus);
    return auth !== undefined && auth !== null && auth.authenticated === false;
  }

  async function runSync(): Promise<void> {
    await ensureInit();
    clearRetry();
    if (!deps.isOnline()) {
      update({ state: 'offline', pending: await countPending() });
      return;
    }
    try {
      if (await isSignedOut()) {
        update({ state: 'idle', pending: await countPending() });
        return;
      }
      update({ state: 'syncing', pending: await countPending() });

      const deviceId = await getDeviceId();
      const settings = await kvGet<ParentSettings>(SYNC_KV_KEYS.parentSettings);
      let cursor = (await kvGet<string | null>(SYNC_KV_KEYS.cursor)) ?? null;
      const storedRestore = await kvGet<string[]>(SYNC_KV_KEYS.restoreKeys);
      let restore = new Set<string>(Array.isArray(storedRestore) ? storedRestore : []);
      let restoreStarted = restore.size > 0;

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const batch = await collectBatch(settings);
        const request: SyncRequest = { cursor, deviceId, changes: batch.changes };
        const response: unknown = await deps.send(request);
        if (!isSyncResponse(response)) throw new ApiError(200, 'invalid_response', 'Invalid sync response');

        for (const tableName of SYNC_TABLE_ORDER) {
          const remote = response.changes[tableName];
          if (Array.isArray(remote) && remote.length > 0) await applyRemoteInternal(tableName, remote as SyncEntity<typeof tableName>[], restore);
        }

        const changedMeanwhile = await settleOutbox(batch.items);
        const rejected: SyncRejection[] = Array.isArray(response.rejected) ? response.rejected : [];
        const newlyRejected = rejected
          .filter((r) => isSyncTable(r.table))
          .map((r) => restoreId(r.table, r.entityKey))
          .filter((id) => !changedMeanwhile.has(id));

        if (rejected.length > 0) await logRejections(rejected);

        const pullDone = !response.hasMore;
        if (newlyRejected.length > 0 && !restoreStarted) {
          // Rejected rows are not pulled again by cursor: a full pull restores the server state (§15.2).
          restore = new Set([...restore, ...newlyRejected]);
          restoreStarted = true;
          cursor = null;
          await db.kv.bulkPut([
            { key: SYNC_KV_KEYS.restoreKeys, value: Array.from(restore) },
            { key: SYNC_KV_KEYS.cursor, value: null },
          ]);
          update({ pending: await countPending() });
          continue;
        }

        if (!pullDone && response.cursor === cursor && batch.items.length === 0) {
          throw new ApiError(200, 'invalid_response', 'Sync cursor did not advance');
        }
        cursor = response.cursor;
        await db.kv.put({ key: SYNC_KV_KEYS.cursor, value: cursor });
        update({ pending: await countPending() });

        if (pullDone && !batch.hasMore) {
          if (restore.size > 0) await db.kv.delete(SYNC_KV_KEYS.restoreKeys);
          break;
        }
      }

      const lastSyncAt = deps.now();
      await db.kv.put({ key: SYNC_KV_KEYS.lastSyncAt, value: lastSyncAt });
      failures = 0;
      nextRetryAt = 0;
      update({ state: 'idle', lastSyncAt, lastError: null, pending: await countPending() });
    } catch (error) {
      failures += 1;
      const delay = computeBackoffMs(failures);
      nextRetryAt = deps.now() + delay;
      const code = error instanceof ApiError ? error.code : 'unknown';
      const offline = code === 'offline';
      update({ state: offline ? 'offline' : 'error', lastError: offline ? null : code, pending: await countPending() });
      scheduleRetry(delay);
    }
  }

  function syncNow(): Promise<void> {
    if (!inFlight) {
      inFlight = runSync()
        .catch(() => undefined)
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    }
    queued ??= inFlight.then(() => {
      queued = null;
      return syncNow();
    });
    return queued;
  }

  // ---------- scheduling ----------

  function clearRetry(): void {
    if (retryTimer !== null) {
      deps.clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetry(delay: number): void {
    clearRetry();
    if (startCount === 0) return;
    retryTimer = deps.setTimeout(() => {
      retryTimer = null;
      void syncNow();
    }, delay);
  }

  function scheduleDebounced(): void {
    if (startCount === 0) return;
    if (debounceTimer !== null) deps.clearTimeout(debounceTimer);
    debounceTimer = deps.setTimeout(() => {
      debounceTimer = null;
      if (failures === 0 || deps.now() >= nextRetryAt) void syncNow();
    }, TIMINGS.syncDebounceMs);
  }

  function scheduleInterval(): void {
    intervalTimer = deps.setTimeout(() => {
      if (startCount === 0) return;
      if (deps.isOnline() && (failures === 0 || deps.now() >= nextRetryAt)) void syncNow();
      scheduleInterval();
    }, TIMINGS.syncIntervalMs);
  }

  const onOnline = (): void => {
    failures = 0;
    nextRetryAt = 0;
    void syncNow();
  };
  const onOffline = (): void => {
    void countPending().then((pending) => update({ state: 'offline', pending }));
  };
  const onVisibility = (): void => {
    if (deps.events?.document?.visibilityState === 'visible' && deps.isOnline() && (failures === 0 || deps.now() >= nextRetryAt)) {
      void syncNow();
    }
  };

  function startSync(): () => void {
    startCount += 1;
    if (startCount === 1) {
      deps.events?.window?.addEventListener('online', onOnline);
      deps.events?.window?.addEventListener('offline', onOffline);
      deps.events?.document?.addEventListener('visibilitychange', onVisibility);
      scheduleInterval();
      void syncNow();
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      startCount -= 1;
      if (startCount > 0) return;
      deps.events?.window?.removeEventListener('online', onOnline);
      deps.events?.window?.removeEventListener('offline', onOffline);
      deps.events?.document?.removeEventListener('visibilitychange', onVisibility);
      for (const timer of [intervalTimer, debounceTimer, retryTimer]) if (timer !== null) deps.clearTimeout(timer);
      intervalTimer = null;
      debounceTimer = null;
      retryTimer = null;
    };
  }

  function subscribeSync(cb: (s: SyncStatus) => void): () => void {
    listeners.add(cb);
    cb({ ...status });
    void ensureInit().then(async () => {
      if (!listeners.has(cb)) return;
      const pending = await countPending();
      if (pending !== status.pending) update({ pending });
      else cb({ ...status });
    });
    return () => {
      listeners.delete(cb);
    };
  }

  async function getPendingCounts(): Promise<Record<SyncTable, number>> {
    const counts = Object.fromEntries(SYNC_TABLE_ORDER.map((t) => [t, 0])) as Record<SyncTable, number>;
    const rows = await db.outbox.toArray();
    for (const row of rows) if (isSyncTable(row.table)) counts[row.table] += 1;
    return counts;
  }

  return {
    saveEntity,
    applyRemote,
    syncNow,
    startSync,
    subscribeSync,
    getStatus: () => ({ ...status }),
    getPendingCounts,
    getDeviceId,
    getLastRejections: async () => (await kvGet<SyncRejectionLog>(SYNC_KV_KEYS.rejected)) ?? null,
  };
}

/**
 * A page pulled without text (privacy.syncDocumentText off on the server) keeps the local text when the content is the
 * same, so a device never loses the text it processed itself.
 */
function keepLocalText(remote: PageContent, local: PageContent): PageContent {
  if (remote.blocks.length === 0 && local.blocks.length > 0 && remote.contentHash !== null && remote.contentHash === local.contentHash) {
    return { ...remote, blocks: local.blocks };
  }
  return remote;
}

function browserEvents(): SyncEngineDeps['events'] {
  return {
    window: typeof window === 'undefined' ? undefined : window,
    document: typeof document === 'undefined' ? undefined : document,
  };
}

const engine = createSyncEngine({
  db: defaultDb,
  send: (req, signal) => postSync(req, signal),
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  events: browserEvents(),
});

/**
 * Every local write of a syncable entity goes through here: writes Dexie + appends to the outbox (§10).
 * Soft deletes: save the entity with `deletedAt` set.
 */
export function saveEntity<T extends SyncTable>(table: T, entity: SyncEntity<T>): Promise<void> {
  return engine.saveEntity(table, entity);
}

/** Applies entities received from the server: Dexie only, NO outbox, local LWW on updatedAt (§15.2). */
export function applyRemote<T extends SyncTable>(table: T, entities: SyncEntity<T>[]): Promise<void> {
  return engine.applyRemote(table, entities);
}

/** Pushes the outbox and pulls remote changes until `hasMore` is false (cursor in kv `syncCursor`). Never throws. */
export function syncNow(): Promise<void> {
  return engine.syncNow();
}

/** Starts background sync (startup, every 60 s online, `online` event, 5 s debounce after changes). Returns a stop function. */
export function startSync(): () => void {
  return engine.startSync();
}

/** Subscribes to the sync status; the callback is called immediately with the current status. Returns an unsubscribe function. */
export function subscribeSync(cb: (s: SyncStatus) => void): () => void {
  return engine.subscribeSync(cb);
}

/** Outbox rows per table (parent sync screen). */
export function getPendingCounts(): Promise<Record<SyncTable, number>> {
  return engine.getPendingCounts();
}

/** Rejections kept from the last syncs (parent sync screen). */
export function getLastRejections(): Promise<SyncRejectionLog | null> {
  return engine.getLastRejections();
}

/** Stable identifier of this device (kv `deviceId`, created on first use). */
export function getDeviceId(): Promise<string> {
  return engine.getDeviceId();
}
