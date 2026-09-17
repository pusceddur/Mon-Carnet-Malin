// Document deletion from the parent area: stops processing, soft-deletes (synced), frees local storage.
import type { Id } from '@aide/shared';
import { deleteDocument } from '../api/documents';
import { db } from '../db/localDb';
import { isOnline } from '../platform/online';
import { saveEntity } from '../sync/SyncEngine';
import { getDocument, purgeDocumentLocalData } from './DocumentCache';
import { forgetUploads } from './pendingUploads';
import { processingQueue } from './ProcessingQueue';

export async function deleteDocumentEverywhere(documentId: Id, now = Date.now()): Promise<void> {
  await processingQueue.cancelDocument(documentId);
  const doc = await getDocument(documentId);
  if (!doc) return;
  const stamp = Math.max(now, doc.updatedAt + 1);
  if (doc.deletedAt === null) await saveEntity('documents', { ...doc, deletedAt: stamp, updatedAt: stamp });
  // The children's notes on this document go with it (the server does the same on DELETE).
  const annotations = await db.annotations.where('documentId').equals(documentId).toArray();
  for (const annotation of annotations) {
    if (annotation.deletedAt === null) {
      await saveEntity('annotations', { ...annotation, deletedAt: stamp, updatedAt: Math.max(stamp, annotation.updatedAt + 1) });
    }
  }
  await purgeDocumentLocalData(documentId);
  await forgetUploads(documentId);
  if (isOnline()) {
    try {
      await deleteDocument(documentId);
    } catch {
      // The synced deletedAt reaches the server later.
    }
  }
}
