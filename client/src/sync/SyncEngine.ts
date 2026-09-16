// STUB: client-shell
import type { SyncEntity, SyncTable } from '@aide/shared';
import { db } from '../db/localDb';

/**
 * Every local write of a syncable entity goes through here: writes Dexie + appends to the outbox (§10).
 * Soft deletes: save the entity with `deletedAt` set.
 */
export async function saveEntity<T extends SyncTable>(table: T, entity: SyncEntity<T>): Promise<void> {
  await db.table(table).put(entity);
}

/** Pushes the outbox and pulls remote changes (LWW on updatedAt). Never throws. */
export async function syncNow(): Promise<void> {}

/** Starts background sync (startup, every 60 s online, `online` event, 5 s debounce after changes). Returns a stop function. */
export function startSync(): () => void {
  return () => {};
}
