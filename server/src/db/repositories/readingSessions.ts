import type { ReadingSession } from '@aide/shared';
import { type Db, type Row, parseJson, toNum, toStr } from './common';

export function readingSessionFromRow(row: Row): ReadingSession {
  const data = parseJson<Partial<ReadingSession>>(row.data_json, {});
  return {
    id: toStr(row.id),
    childId: toStr(row.child_id),
    documentId: toStr(row.document_id),
    startedAt: toNum(row.started_at),
    endedAt: toNum(row.ended_at),
    pagesViewed: Array.isArray(data.pagesViewed) ? data.pagesViewed : [],
    ttsSeconds: typeof data.ttsSeconds === 'number' ? data.ttsSeconds : 0,
    wordsLookedUp: typeof data.wordsLookedUp === 'number' ? data.wordsLookedUp : 0,
    aiRequests: typeof data.aiRequests === 'number' ? data.aiRequests : 0,
    updatedAt: toNum(row.updated_at),
  };
}

export async function findReadingSession(db: Db, id: string): Promise<{ parentId: string; session: ReadingSession } | null> {
  const row = (await db('reading_sessions').where('id', id).first()) as Row | undefined;
  return row ? { parentId: toStr(row.parent_id), session: readingSessionFromRow(row) } : null;
}

export async function saveReadingSession(db: Db, parentId: string, s: ReadingSession, serverSeq: number): Promise<void> {
  const { pagesViewed, ttsSeconds, wordsLookedUp, aiRequests } = s;
  await db('reading_sessions')
    .insert({
      id: s.id,
      parent_id: parentId,
      child_id: s.childId,
      document_id: s.documentId,
      started_at: s.startedAt,
      ended_at: s.endedAt,
      data_json: JSON.stringify({ pagesViewed, ttsSeconds, wordsLookedUp, aiRequests }),
      updated_at: s.updatedAt,
      server_seq: serverSeq,
    })
    .onConflict('id')
    .merge();
}

/** Reading sessions of a parent started in [from, to], newest first (activity view). */
export async function listReadingSessions(
  db: Db,
  parentId: string,
  opts: { childId?: string; from: number; to: number; limit?: number },
): Promise<ReadingSession[]> {
  const query = db('reading_sessions')
    .where('parent_id', parentId)
    .andWhere('started_at', '>=', opts.from)
    .andWhere('started_at', '<=', opts.to)
    .orderBy('started_at', 'desc')
    .limit(opts.limit ?? 500);
  if (opts.childId) query.andWhere('child_id', opts.childId);
  const rows = (await query) as Row[];
  return rows.map(readingSessionFromRow);
}
