// §30 « Supprimer le compte »: removing a family from the server for good.
//
// Immediate and final, not a flag and a countdown. Fewer states to get wrong, and the data of a child is kept for as
// little time as possible — which is both the rule the project set itself and what the GDPR asks for (art. 17).
//
// The order matters. Sessions go first, so that no device can write anything while the rest is being removed; then
// every table keyed to the family; then the account itself. The files on disk go last, after the transaction has
// been committed: a file that refuses to be deleted must not put the whole account back.

import type { Knex } from 'knex';
import { DELETED_ACCOUNTS_TABLE } from '../migrations/011_account_deletion';
import { removeStored } from '../storage/uploads';
import { type Db, type Row, toStr } from './common';

/** How long the hashes of a deleted account's session tokens are kept, so a device that was off is still answered. */
export const DELETED_ACCOUNT_TOKENS_RETENTION_MS = 180 * 24 * 60 * 60_000;

/**
 * Every table holding rows of one family, found by `parent_id`.
 *
 * Written out rather than derived, on purpose: a table added later and forgotten here would leave a child's work on
 * the server after their parent asked for it to go. The test `accountDeletion.test.ts` walks the schema and fails
 * when a table with a `parent_id` column is missing from this list.
 */
export const PARENT_TABLES = [
  'answers', 'annotations', 'exercises', 'reading_progress', 'reading_sessions',
  'document_page_images', 'document_files', 'document_pages', 'documents', 'ocr_results',
  'children', 'settings', 'glossary_entries',
  'ai_requests', 'ai_jobs', 'ai_cache', 'safety_alerts', 'free_questions', 'writing_corrections',
  'worker_jobs', 'worker_usage', 'client_diagnostics',
  'sync_counters',
] as const;

/** Tables keyed to the account itself rather than to the family. */
const USER_TABLES = ['sessions', 'email_tokens'] as const;

export interface AccountDeletionReport {
  /** Rows removed, all tables together. */
  rows: number;
  /** Files removed from disk (originals and page images). */
  files: number;
  /** Sessions closed, and whose hashes are now in `deleted_accounts`. */
  sessions: number;
}

/**
 * Whether this account is the one that installed the server, while other families still use it.
 *
 * There is no column saying who the owner is; the oldest account is. Letting it delete itself with other families on
 * the server would leave them on a server nobody administers.
 */
export async function isOwnerOfSharedServer(db: Db, parentId: string): Promise<boolean> {
  const rows = (await db('users').select('id').orderBy('created_at', 'asc').limit(2)) as Row[];
  return rows.length > 1 && toStr(rows[0]?.id) === parentId;
}

/** Deletes the account and everything of the family, and returns what went. */
export async function deleteAccount(
  db: Knex, uploadsRoot: string, parentId: string, now: number,
): Promise<AccountDeletionReport> {
  // Read before the transaction: paths on disk, and the session hashes to remember.
  const paths = await storagePathsOf(db, parentId);
  const sessions = (await db('sessions').select('id').where('user_id', parentId)) as Row[];

  let rows = 0;
  await db.transaction(async (trx) => {
    // A device that was switched off during the deletion still holds one of these. Nothing here says whose they
    // were: the hash of a token, and a date.
    for (const session of sessions) {
      await trx(DELETED_ACCOUNTS_TABLE)
        .insert({ session_hash: toStr(session.id), deleted_at: now })
        .onConflict('session_hash')
        .merge(['deleted_at']);
    }
    for (const table of USER_TABLES) rows += await trx(table).where('user_id', parentId).delete();
    for (const table of PARENT_TABLES) rows += await trx(table).where('parent_id', parentId).delete();
    rows += await trx('users').where('id', parentId).delete();
  });

  // The transaction is committed: the account no longer exists whatever happens now.
  let files = 0;
  for (const path of paths) {
    await removeStored(uploadsRoot, path);
    files += 1;
  }
  return { rows, files, sessions: sessions.length };
}

async function storagePathsOf(db: Db, parentId: string): Promise<string[]> {
  const paths: string[] = [];
  for (const table of ['document_files', 'document_page_images'] as const) {
    const rows = (await db(table).select('storage_path').where('parent_id', parentId)) as Row[];
    for (const row of rows) {
      const path = toStr(row.storage_path);
      if (path) paths.push(path);
    }
  }
  return paths;
}

/**
 * Whether a session token belonged to an account that has been deleted.
 *
 * Asked only when the token matches no session, which is the same answer an expired one gets: nothing here tells
 * anybody anything they could not already see.
 */
export async function wasDeleted(db: Db, sessionHash: string): Promise<boolean> {
  const row = (await db(DELETED_ACCOUNTS_TABLE).select('session_hash').where('session_hash', sessionHash).first()) as
    | Row
    | undefined;
  return row !== undefined;
}

/** Forgets the hashes older than the life of a session: after that, no device can still be carrying one. */
export async function purgeDeletedAccountTokens(db: Db, cutoff: number): Promise<number> {
  return db(DELETED_ACCOUNTS_TABLE).where('deleted_at', '<', cutoff).delete();
}
