// §15.2 pull: rows with server_seq > cursor across every synced table, in seq order, paged.
import { LIMITS, type ParentSettings, type SyncChanges, syncEntityKey, type SyncEntity, type SyncTable } from '@aide/shared';
import type { Knex } from 'knex';
import { annotationFromRow, findAnnotation } from '../repositories/annotations';
import { answerFromRow, findAnswer } from '../repositories/answers';
import { childFromRow, getChild } from '../repositories/children';
import { type Row, toNum, toStr } from '../repositories/common';
import { documentFromRow, getDocument } from '../repositories/documents';
import { exerciseFromRow, findExercise } from '../repositories/exercises';
import { findPage, pageFromRow } from '../repositories/pages';
import { findProgress, progressFromRow } from '../repositories/progress';
import { findReadingSession, readingSessionFromRow } from '../repositories/readingSessions';
import { currentSeq } from '../repositories/syncCounters';
import type { RestoreRef } from './push';

/** Soft cap of one pull response (sum of stored JSON sizes); at least one row is always returned. */
export const PULL_MAX_BYTES = 8 * 1024 * 1024;

interface PullTable {
  sync: SyncTable;
  table: string;
  /** Column whose length estimates the payload size. */
  sizeColumn: string | null;
  map(row: Row): SyncChanges[SyncTable][number];
}

const PULL_TABLES: readonly PullTable[] = [
  { sync: 'children', table: 'children', sizeColumn: 'preferences_json', map: childFromRow },
  { sync: 'documents', table: 'documents', sizeColumn: 'child_ids_json', map: documentFromRow },
  { sync: 'pages', table: 'document_pages', sizeColumn: 'blocks_json', map: pageFromRow },
  { sync: 'exercises', table: 'exercises', sizeColumn: 'data_json', map: exerciseFromRow },
  { sync: 'annotations', table: 'annotations', sizeColumn: 'data_json', map: annotationFromRow },
  { sync: 'answers', table: 'answers', sizeColumn: 'data_json', map: answerFromRow },
  { sync: 'progress', table: 'reading_progress', sizeColumn: null, map: progressFromRow },
  { sync: 'sessions', table: 'reading_sessions', sizeColumn: 'data_json', map: readingSessionFromRow },
];

export function emptyChanges(): SyncChanges {
  return { documents: [], pages: [], annotations: [], progress: [], sessions: [], exercises: [], answers: [], children: [] };
}

export interface PullResult { changes: SyncChanges; cursor: number; hasMore: boolean }

export interface PullOptions { maxRows?: number; maxBytes?: number }

/** Parses the opaque cursor ("" / null = start). Returns null when malformed. */
export function parseCursor(cursor: string | null): number | null {
  if (cursor === null) return 0;
  return /^\d{1,15}$/.test(cursor) ? Number(cursor) : null;
}

export async function pullChanges(
  db: Knex,
  parentId: string,
  cursorIn: number,
  settings: ParentSettings,
  opts: PullOptions = {},
): Promise<PullResult> {
  const maxRows = opts.maxRows ?? LIMITS.syncPullMaxRows;
  const maxBytes = opts.maxBytes ?? PULL_MAX_BYTES;
  const tables = PULL_TABLES.filter((t) => t.sync !== 'annotations' || settings.privacy.syncAnnotations);

  // A cursor from the future (restored database) restarts a full pull.
  const counter = await currentSeq(db, parentId);
  const cursor = cursorIn > counter ? 0 : cursorIn;

  // Phase 1: light scan (seq + size) to choose the page window without loading large rows.
  const candidates: { seq: number; size: number }[] = [];
  for (const t of tables) {
    const columns: (string | Knex.Raw)[] = ['server_seq'];
    if (t.sizeColumn) columns.push(db.raw('length(??) as size', [t.sizeColumn]));
    const rows = (await db(t.table)
      .select(columns)
      .where('parent_id', parentId)
      .andWhere('server_seq', '>', cursor)
      .orderBy('server_seq', 'asc')
      .limit(maxRows + 1)) as Row[];
    for (const row of rows) candidates.push({ seq: toNum(row.server_seq), size: toNum(row.size) });
  }
  candidates.sort((a, b) => a.seq - b.seq);

  let taken = 0;
  let bytes = 0;
  let lastSeq = cursor;
  for (const c of candidates) {
    if (taken >= maxRows || (taken > 0 && bytes + c.size > maxBytes)) break;
    taken += 1;
    bytes += c.size;
    lastSeq = c.seq;
  }
  const hasMore = candidates.length > taken;
  const changes = emptyChanges();
  if (taken === 0) return { changes, cursor: Math.max(cursor, 0), hasMore: false };

  // Phase 2: full rows inside (cursor, lastSeq]. Rows rewritten meanwhile moved above lastSeq and come next time.
  const deletedDocuments = new Set<string>();
  const docRows = (await db('documents').select('id').where('parent_id', parentId).whereNotNull('deleted_at')) as Row[];
  for (const row of docRows) deletedDocuments.add(toStr(row.id));

  for (const t of tables) {
    const rows = (await db(t.table)
      .where('parent_id', parentId)
      .andWhere('server_seq', '>', cursor)
      .andWhere('server_seq', '<=', lastSeq)
      .orderBy('server_seq', 'asc')) as Row[];
    for (const row of rows) {
      // Text of deleted documents is not sent again (their tombstone is).
      if (t.sync === 'pages' && deletedDocuments.has(toStr(row.document_id))) continue;
      (changes[t.sync] as unknown[]).push(t.map(row));
    }
  }
  return { changes, cursor: lastSeq, hasMore };
}

async function loadOwned(db: Knex, parentId: string, settings: ParentSettings, ref: RestoreRef): Promise<SyncEntity<SyncTable> | null> {
  const { id, childId, documentId, pageIndex } = ref;
  const own = <T extends { parentId: string }>(found: T | null): T | null => (found && found.parentId === parentId ? found : null);
  switch (ref.table) {
    case 'children':
      return id ? getChild(db, parentId, id, { includeDeleted: true }) : null;
    case 'documents':
      return id ? getDocument(db, parentId, id, { includeDeleted: true }) : null;
    case 'pages':
      if (!documentId || pageIndex === null || !(await getDocument(db, parentId, documentId))) return null;
      return own(await findPage(db, documentId, pageIndex))?.page ?? null;
    case 'exercises':
      return id ? (own(await findExercise(db, id))?.exercise ?? null) : null;
    case 'annotations':
      if (!settings.privacy.syncAnnotations || !id) return null;
      return own(await findAnnotation(db, id))?.annotation ?? null;
    case 'answers':
      return id ? (own(await findAnswer(db, id))?.answer ?? null) : null;
    case 'progress':
      return childId && documentId ? (own(await findProgress(db, childId, documentId))?.progress ?? null) : null;
    case 'sessions':
      return id ? (own(await findReadingSession(db, id))?.session ?? null) : null;
  }
}

/**
 * Adds the current server version of rejected entities (stale, parent_locked, ignored child fields) to `changes`
 * when the pull does not already contain them, so that a device whose cursor is past them can restore the server state.
 */
export async function addRestoredEntities(
  db: Knex,
  parentId: string,
  settings: ParentSettings,
  refs: readonly RestoreRef[],
  changes: SyncChanges,
): Promise<void> {
  const present = new Set<string>();
  for (const table of Object.keys(changes) as SyncTable[]) {
    for (const entity of changes[table]) present.add(`${table}|${syncEntityKey(table, entity)}`);
  }
  for (const ref of refs) {
    const entity = await loadOwned(db, parentId, settings, ref);
    if (!entity) continue;
    const key = `${ref.table}|${syncEntityKey(ref.table, entity)}`;
    if (present.has(key)) continue;
    present.add(key);
    (changes[ref.table] as unknown[]).push(entity);
  }
}
