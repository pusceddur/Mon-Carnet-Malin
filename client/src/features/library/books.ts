import type { DocumentMeta, Id, ReadingProgress } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../../db/localDb';

export interface BookItem { document: DocumentMeta; progress: ReadingProgress | null }

/** Documents to read (homework sheets are in « Mes devoirs », §19.3). */
export function isBookOfChild(document: DocumentMeta, childId: Id): boolean {
  return document.deletedAt === null && document.childIds.includes(childId) && document.purpose !== 'homework';
}

/** Books assigned to the child: last read first, then newest. */
export function listChildBooks(documents: readonly DocumentMeta[], progress: readonly ReadingProgress[], childId: Id): BookItem[] {
  const byDocument = new Map<Id, ReadingProgress>();
  for (const p of progress) if (p.childId === childId) byDocument.set(p.documentId, p);
  return documents
    .filter((d) => isBookOfChild(d, childId))
    .map((document) => ({ document, progress: byDocument.get(document.id) ?? null }))
    .sort((a, b) => (b.progress?.updatedAt ?? -1) - (a.progress?.updatedAt ?? -1) || b.document.createdAt - a.document.createdAt);
}

/** Most recently read book that is still assigned to the child. */
export function pickContinueReading(documents: readonly DocumentMeta[], progress: readonly ReadingProgress[], childId: Id): BookItem | null {
  const first = listChildBooks(documents, progress, childId)[0];
  return first?.progress ? first : null;
}

const EMPTY: BookItem[] = [];

async function loadBooks(childId: Id): Promise<BookItem[]> {
  const [documents, progress] = await Promise.all([
    db.documents.filter((d) => isBookOfChild(d, childId)).toArray(),
    db.progress.where('childId').equals(childId).toArray(),
  ]);
  return listChildBooks(documents, progress, childId);
}

/** Live list of the child's books (undefined while loading). */
export function useChildBooks(childId: Id | null): BookItem[] | undefined {
  return useLiveQuery(() => (childId === null ? EMPTY : loadBooks(childId)), [childId]);
}

/** Live thumbnail blob of the first page (null when not generated yet). */
export function usePageThumbBlob(documentId: Id): Blob | null {
  return useLiveQuery(async () => (await db.pageImages.get([documentId, 0, 'thumb']))?.blob ?? null, [documentId], null);
}

/** Object URL of a blob, revoked when the blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (blob === null || typeof URL.createObjectURL !== 'function') {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
