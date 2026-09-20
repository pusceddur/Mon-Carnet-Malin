import type { DocumentKind, DocumentMeta, DocumentStatus, DocumentTextMode } from '@aide/shared';
import type { SeqAllocator } from './syncCounters';
import { type Db, type Row, parseJson, toNum, toNumOrNull, toStr, updateEach } from './common';
import { skipQueuedDocumentJobs } from './workerJobs';

export function documentFromRow(row: Row): DocumentMeta {
  const childIds = parseJson<unknown>(row.child_ids_json, []);
  return {
    id: toStr(row.id),
    ownerParentId: toStr(row.parent_id),
    childIds: Array.isArray(childIds) ? childIds.filter((c): c is string => typeof c === 'string') : [],
    title: toStr(row.title),
    kind: toStr(row.kind) as DocumentKind,
    textMode: toStr(row.text_mode) === 'punctuated' ? 'punctuated' : 'faithful',
    purpose: toStr(row.purpose) === 'homework' ? 'homework' : 'reading',
    homeworkDoneAt: toNumOrNull(row.homework_done_at),
    sourceHash: toStr(row.source_hash),
    pageCount: toNum(row.page_count),
    status: toStr(row.status) as DocumentStatus,
    createdAt: toNum(row.created_at),
    updatedAt: toNum(row.updated_at),
    deletedAt: toNumOrNull(row.deleted_at),
  };
}

/** Document of this parent (null when absent, foreign, or soft-deleted unless `includeDeleted`). */
export async function getDocument(db: Db, parentId: string, id: string, opts: { includeDeleted?: boolean } = {}): Promise<DocumentMeta | null> {
  const row = (await db('documents').where({ id, parent_id: parentId }).first()) as Row | undefined;
  if (!row) return null;
  const doc = documentFromRow(row);
  return doc.deletedAt !== null && !opts.includeDeleted ? null : doc;
}

/** Document by primary key regardless of owner (ownership checks in sync). */
export async function findDocumentById(db: Db, id: string): Promise<DocumentMeta | null> {
  const row = (await db('documents').where('id', id).first()) as Row | undefined;
  return row ? documentFromRow(row) : null;
}

export async function saveDocument(db: Db, doc: DocumentMeta, serverSeq: number): Promise<void> {
  await db('documents')
    .insert({
      id: doc.id,
      parent_id: doc.ownerParentId,
      title: doc.title,
      kind: doc.kind,
      text_mode: doc.textMode,
      purpose: doc.purpose,
      homework_done_at: doc.homeworkDoneAt,
      source_hash: doc.sourceHash,
      page_count: doc.pageCount,
      status: doc.status,
      child_ids_json: JSON.stringify(doc.childIds),
      created_at: doc.createdAt,
      updated_at: doc.updatedAt,
      deleted_at: doc.deletedAt,
      server_seq: serverSeq,
    })
    .onConflict('id')
    .merge();
}

/**
 * §17.10: new text mode of a live document of this parent, with a new server_seq so that every device pulls it.
 * Returns the saved document (unchanged when the mode is already the requested one), null when not found.
 */
export async function setDocumentTextMode(db: Db, parentId: string, id: string, textMode: DocumentTextMode, now: number, seq: SeqAllocator): Promise<DocumentMeta | null> {
  const doc = await getDocument(db, parentId, id);
  if (!doc) return null;
  if (doc.textMode === textMode) return doc;
  const next: DocumentMeta = { ...doc, textMode, updatedAt: Math.max(now, doc.updatedAt + 1) };
  await saveDocument(db, next, seq.next());
  return next;
}

/**
 * Soft-deletes the annotations and exercises of a document, each tombstone with its own server_seq, and closes its page jobs
 * still waiting for the worker.
 */
export async function cascadeDocumentDeletion(db: Db, parentId: string, documentId: string, now: number, seq: SeqAllocator): Promise<void> {
  await skipQueuedDocumentJobs(db, parentId, documentId, now);
  for (const table of ['annotations', 'exercises'] as const) {
    const ids = (await db(table).select('id').where({ parent_id: parentId, document_id: documentId }).whereNull('deleted_at')) as Row[];
    if (ids.length === 0) continue;
    const values = ids.map((r) => [toStr(r.id), seq.next()] as const);
    await updateEach(db, table, 'id', 'server_seq', values, { deleted_at: now, updated_at: now });
  }
}

/** Soft-deletes a document of this parent and cascades; returns false when the document is not found. */
export async function softDeleteDocument(db: Db, parentId: string, id: string, now: number, seq: SeqAllocator): Promise<boolean> {
  const doc = await getDocument(db, parentId, id, { includeDeleted: true });
  if (!doc) return false;
  if (doc.deletedAt !== null) return true;
  const updatedAt = Math.max(now, doc.updatedAt + 1);
  await saveDocument(db, { ...doc, deletedAt: updatedAt, updatedAt }, seq.next());
  await cascadeDocumentDeletion(db, parentId, id, updatedAt, seq);
  return true;
}
