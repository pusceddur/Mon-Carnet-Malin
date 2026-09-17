import type { ReadingProgress } from '@aide/shared';
import { type Db, type Row, toNum, toStr } from './common';

export function progressFromRow(row: Row): ReadingProgress {
  return {
    childId: toStr(row.child_id),
    documentId: toStr(row.document_id),
    pageIndex: toNum(row.page_index),
    blockIndex: toNum(row.block_index),
    sentenceIndex: toNum(row.sentence_index),
    updatedAt: toNum(row.updated_at),
  };
}

export async function findProgress(db: Db, childId: string, documentId: string): Promise<{ parentId: string; progress: ReadingProgress } | null> {
  const row = (await db('reading_progress').where({ child_id: childId, document_id: documentId }).first()) as Row | undefined;
  return row ? { parentId: toStr(row.parent_id), progress: progressFromRow(row) } : null;
}

export async function saveProgress(db: Db, parentId: string, p: ReadingProgress, serverSeq: number): Promise<void> {
  await db('reading_progress')
    .insert({
      child_id: p.childId,
      document_id: p.documentId,
      parent_id: parentId,
      page_index: p.pageIndex,
      block_index: p.blockIndex,
      sentence_index: p.sentenceIndex,
      updated_at: p.updatedAt,
      server_seq: serverSeq,
    })
    .onConflict(['child_id', 'document_id'])
    .merge();
}
