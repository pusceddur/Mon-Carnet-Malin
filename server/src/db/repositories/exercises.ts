import type { Exercise } from '@aide/shared';
import { type Db, type Row, parseJson, toNum, toNumOrNull, toStr } from './common';

export function exerciseFromRow(row: Row): Exercise {
  const data = parseJson<Exercise>(row.data_json, {} as Exercise);
  return {
    ...data,
    id: toStr(row.id),
    childId: toStr(row.child_id),
    documentId: toStr(row.document_id),
    updatedAt: toNum(row.updated_at),
    deletedAt: toNumOrNull(row.deleted_at),
  };
}

export async function findExercise(db: Db, id: string): Promise<{ parentId: string; exercise: Exercise } | null> {
  const row = (await db('exercises').where('id', id).first()) as Row | undefined;
  return row ? { parentId: toStr(row.parent_id), exercise: exerciseFromRow(row) } : null;
}

export async function saveExercise(db: Db, parentId: string, e: Exercise, serverSeq: number): Promise<void> {
  await db('exercises')
    .insert({
      id: e.id,
      parent_id: parentId,
      child_id: e.childId,
      document_id: e.documentId,
      data_json: JSON.stringify(e),
      created_at: e.createdAt,
      updated_at: e.updatedAt,
      deleted_at: e.deletedAt,
      server_seq: serverSeq,
    })
    .onConflict('id')
    .merge();
}
