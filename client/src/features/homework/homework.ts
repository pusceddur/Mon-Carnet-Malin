// « Mes devoirs » (§19.3): homework sheets of the child (photos, screenshots or PDF completed in the app).
import type { DocumentMeta, Id } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/localDb';
import { documentPurpose } from '../../documents/DocumentCache';
import { saveEntity } from '../../sync/SyncEngine';

export interface HomeworkLists {
  /** Newest first. */
  todo: DocumentMeta[];
  /** Most recently finished first. */
  done: DocumentMeta[];
}

export const homeworkPath = (documentId: Id): string => `/devoirs/${encodeURIComponent(documentId)}`;

export function isHomeworkOfChild(document: DocumentMeta, childId: Id): boolean {
  return document.deletedAt === null && document.childIds.includes(childId) && documentPurpose(document) === 'homework';
}

export function splitHomework(documents: readonly DocumentMeta[], childId: Id): HomeworkLists {
  const mine = documents.filter((d) => isHomeworkOfChild(d, childId));
  return {
    todo: mine.filter((d) => !d.homeworkDoneAt).sort((a, b) => b.createdAt - a.createdAt),
    done: mine.filter((d) => d.homeworkDoneAt).sort((a, b) => (b.homeworkDoneAt ?? 0) - (a.homeworkDoneAt ?? 0)),
  };
}

const EMPTY: HomeworkLists = { todo: [], done: [] };

/** Live homework of the child (undefined while loading). */
export function useChildHomework(childId: Id | null): HomeworkLists | undefined {
  return useLiveQuery(
    async () => (childId === null ? EMPTY : splitHomework(await db.documents.filter((d) => isHomeworkOfChild(d, childId)).toArray(), childId)),
    [childId],
  );
}

const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

/** « 19 septembre » */
export function formatDay(millis: number): string {
  return dayFormat.format(new Date(millis));
}

/** « J'ai terminé » / « Pas encore fini »: synced like the title (no parent code needed). */
export async function setHomeworkDone(documentId: Id, done: boolean, now = Date.now()): Promise<void> {
  const current = await db.documents.get(documentId);
  if (!current || current.deletedAt !== null || Boolean(current.homeworkDoneAt) === done) return;
  await saveEntity('documents', { ...current, homeworkDoneAt: done ? now : null, updatedAt: Math.max(now, current.updatedAt + 1) });
}
