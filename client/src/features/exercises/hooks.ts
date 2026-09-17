import { DEFAULT_PARENT_SETTINGS, type Answer, type DocumentMeta, type Exercise, type Id, type PageContent, type ParentSettings } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef } from 'react';
import { db } from '../../db/localDb';
import { useSessionStore } from '../../state/session';
import { isDocumentVisibleToChild } from './lib/documentPages';

export function useParentSettings(): ParentSettings {
  return useSessionStore((s) => s.parentSettings) ?? DEFAULT_PARENT_SETTINGS;
}

const LOADING = Symbol('loading');
type Loading = typeof LOADING;

export type DocumentData =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; doc: DocumentMeta; pages: PageContent[] };

/** Document metadata and its pages (live: pages become usable while the book is still being processed). */
export function useDocumentData(documentId: Id | undefined): DocumentData {
  const doc = useLiveQuery<DocumentMeta | null, Loading>(
    async () => (documentId ? ((await db.documents.get(documentId)) ?? null) : null),
    [documentId],
    LOADING,
  );
  const pages = useLiveQuery<PageContent[], Loading>(
    () => (documentId ? db.pages.where('documentId').equals(documentId).toArray() : []),
    [documentId],
    LOADING,
  );
  if (doc === LOADING || pages === LOADING) return { status: 'loading' };
  if (!doc || doc.deletedAt !== null) return { status: 'missing' };
  return { status: 'ready', doc, pages: [...pages].sort((a, b) => a.pageIndex - b.pageIndex) };
}

export function useChildDocuments(childId: Id): DocumentMeta[] | undefined {
  return useLiveQuery(async () => {
    const docs = await db.documents.toArray();
    return docs
      .filter((d) => isDocumentVisibleToChild(d, childId))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title, 'fr'));
  }, [childId]);
}

export interface ChildHistory { exercises: Exercise[]; answers: Answer[] }

export function useChildHistory(childId: Id): ChildHistory | undefined {
  return useLiveQuery(async () => {
    const [exercises, answers] = await Promise.all([
      db.exercises.where('childId').equals(childId).toArray(),
      db.answers.where('childId').equals(childId).toArray(),
    ]);
    return {
      exercises: exercises.filter((e) => e.deletedAt === null).sort((a, b) => b.createdAt - a.createdAt),
      answers,
    };
  }, [childId]);
}

export type ExerciseData =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; exercise: Exercise; answers: Answer[]; doc: DocumentMeta | null };

/** Exercise, its answers and its book, loaded together so the player never starts without the book hash. */
export function useExerciseData(exerciseId: Id | undefined, childId: Id): ExerciseData {
  const data = useLiveQuery<{ exercise: Exercise; answers: Answer[]; doc: DocumentMeta | null } | null, Loading>(
    async () => {
      const exercise = exerciseId ? await db.exercises.get(exerciseId) : undefined;
      if (!exercise) return null;
      const [answers, doc] = await Promise.all([
        db.answers.where('exerciseId').equals(exercise.id).toArray(),
        db.documents.get(exercise.documentId),
      ]);
      return { exercise, answers, doc: doc && doc.deletedAt === null ? doc : null };
    },
    [exerciseId],
    LOADING,
  );
  if (data === LOADING) return { status: 'loading' };
  if (!data || data.exercise.deletedAt !== null || data.exercise.childId !== childId) return { status: 'missing' };
  return { status: 'ready', ...data };
}

/** Starts a fresh AbortController per task; the running one is aborted on restart, on `abort()` and on unmount. */
export function useAbortable(): { start: () => AbortSignal; abort: () => void } {
  const controller = useRef<AbortController | null>(null);
  const abort = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);
  const start = useCallback(() => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    return next.signal;
  }, []);
  useEffect(() => abort, [abort]);
  return { start, abort };
}
