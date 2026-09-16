// STUB: client-pencil
import { newId, type Annotation, type Id, type TextHighlight } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/localDb';
import { saveEntity } from '../sync/SyncEngine';

const EMPTY: never[] = [];

/** liveQuery of non-deleted annotations of a document for a child. */
export function useAnnotations(documentId: Id, childId: Id): Annotation[] {
  return useLiveQuery(
    () => db.annotations.where('[documentId+childId]').equals([documentId, childId]).filter((a) => a.deletedAt === null).toArray(),
    [documentId, childId],
    EMPTY,
  );
}

export function useTextHighlights(documentId: Id, childId: Id, pageIndex: number): TextHighlight[] {
  const all = useAnnotations(documentId, childId);
  return all.filter((a): a is TextHighlight => a.type === 'highlight' && a.pageIndex === pageIndex);
}

export async function addTextHighlight(h: Omit<TextHighlight, 'id' | 'type' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<TextHighlight> {
  const now = Date.now();
  const highlight: TextHighlight = { ...h, id: newId(), type: 'highlight', createdAt: now, updatedAt: now, deletedAt: null };
  await saveEntity('annotations', highlight);
  return highlight;
}

export async function removeAnnotation(id: Id): Promise<void> {
  const existing = await db.annotations.get(id);
  if (!existing) return;
  const now = Date.now();
  await saveEntity('annotations', { ...existing, deletedAt: now, updatedAt: now });
}
