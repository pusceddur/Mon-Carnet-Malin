import type { Annotation } from '@aide/shared';
import { type Db, type Row, parseJson, toNum, toNumOrNull, toStr } from './common';

/** The full annotation is stored in data_json; key columns win over the JSON copy. */
export function annotationFromRow(row: Row): Annotation {
  const data = parseJson<Annotation>(row.data_json, {} as Annotation);
  return {
    ...data,
    id: toStr(row.id),
    childId: toStr(row.child_id),
    updatedAt: toNum(row.updated_at),
    deletedAt: toNumOrNull(row.deleted_at),
  } as Annotation;
}

export async function findAnnotation(db: Db, id: string): Promise<{ parentId: string; annotation: Annotation } | null> {
  const row = (await db('annotations').where('id', id).first()) as Row | undefined;
  return row ? { parentId: toStr(row.parent_id), annotation: annotationFromRow(row) } : null;
}

export async function saveAnnotation(db: Db, parentId: string, a: Annotation, serverSeq: number): Promise<void> {
  await db('annotations')
    .insert({
      id: a.id,
      parent_id: parentId,
      child_id: a.childId,
      document_id: a.documentId,
      type: a.type,
      data_json: JSON.stringify(a),
      created_at: a.createdAt,
      updated_at: a.updatedAt,
      deleted_at: a.deletedAt,
      server_seq: serverSeq,
    })
    .onConflict('id')
    .merge();
}
