// Annotation persistence (Dexie through saveEntity) and undoable commands: add, erase, partial erase, clear page, highlight,
// text boxes of the original page (§19.2).
import { newId, type Annotation, type Id, type InkAnnotation, type PageContent, type TextBoxAnnotation, type TextHighlight } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/localDb';
import { saveEntity } from '../sync/SyncEngine';
import { annotationPageIndex, isOrphanAnnotation } from './anchoring';
import { answerHistoryKey, documentHistoryKey, pushCommand, runExclusive, type AnnotationCommand, type CommandApplier } from './history';

const EMPTY_ANNOTATIONS: Annotation[] = [];
const EMPTY_INK: InkAnnotation[] = [];

function nextUpdatedAt(previous: number): number {
  return Math.max(Date.now(), previous + 1);
}

/** History key of an annotation: its document (per child) or its answer box. */
export function historyKeyFor(a: Annotation): string | null {
  if (a.type === 'ink' && a.space.kind === 'answer') return answerHistoryKey(a.space.exerciseId, a.space.questionId, a.childId);
  return a.documentId === null ? null : documentHistoryKey(a.documentId, a.childId);
}

function liveAnnotations(documentId: Id, childId: Id): Promise<Annotation[]> {
  return db.annotations
    .where('[documentId+childId]')
    .equals([documentId, childId])
    .filter((a) => a.deletedAt === null)
    .toArray();
}

/** liveQuery of the non-deleted annotations of a document for a child. */
export function useAnnotations(documentId: Id, childId: Id): Annotation[] {
  return useLiveQuery(() => liveAnnotations(documentId, childId), [documentId, childId], EMPTY_ANNOTATIONS);
}

export function useTextHighlights(documentId: Id, childId: Id, pageIndex: number): TextHighlight[] {
  const all = useAnnotations(documentId, childId);
  return useMemo(() => all.filter((a): a is TextHighlight => a.type === 'highlight' && a.pageIndex === pageIndex), [all, pageIndex]);
}

export function usePageContent(documentId: Id, pageIndex: number, enabled = true): PageContent | undefined {
  return useLiveQuery(() => (enabled ? db.pages.get([documentId, pageIndex]) : undefined), [documentId, pageIndex, enabled]);
}

function isAnswerInk(a: Annotation, exerciseId: Id, questionId: string, childId: Id): a is InkAnnotation {
  return a.type === 'ink' && a.childId === childId && a.deletedAt === null && a.space.kind === 'answer' && a.space.exerciseId === exerciseId && a.space.questionId === questionId;
}

/** Strokes of an answer box, oldest first. */
export async function getAnswerInk(exerciseId: Id, questionId: string, childId: Id): Promise<InkAnnotation[]> {
  const list = await db.annotations
    .where('childId')
    .equals(childId)
    .filter((a) => isAnswerInk(a, exerciseId, questionId, childId))
    .toArray();
  return (list as InkAnnotation[]).sort((x, y) => x.createdAt - y.createdAt);
}

export function useAnswerInk(exerciseId: Id, questionId: string, childId: Id): InkAnnotation[] {
  return useLiveQuery(() => getAnswerInk(exerciseId, questionId, childId), [exerciseId, questionId, childId], EMPTY_INK);
}

/** Text annotations that can no longer be placed in their page text (« Note détachée du texte » in Mes notes). */
export async function getOrphanAnnotations(documentId: Id, childId: Id): Promise<Annotation[]> {
  const [annotations, pages] = await Promise.all([liveAnnotations(documentId, childId), db.pages.where('documentId').equals(documentId).toArray()]);
  const byIndex = new Map(pages.map((p) => [p.pageIndex, p]));
  return annotations.filter((a) => {
    const pageIndex = annotationPageIndex(a);
    return pageIndex !== null && isOrphanAnnotation(a, byIndex.get(pageIndex));
  });
}

export function useOrphanAnnotations(documentId: Id, childId: Id): Annotation[] {
  return useLiveQuery(() => getOrphanAnnotations(documentId, childId), [documentId, childId], EMPTY_ANNOTATIONS);
}

async function setDeleted(snapshot: Annotation, deleted: boolean): Promise<Annotation> {
  const current = (await db.annotations.get(snapshot.id)) ?? snapshot;
  if ((current.deletedAt !== null) === deleted) return current;
  const updatedAt = nextUpdatedAt(current.updatedAt);
  const next: Annotation = { ...current, deletedAt: deleted ? updatedAt : null, updatedAt };
  await saveEntity('annotations', next);
  return next;
}

/** Applies a command backwards (undo) or forwards (redo). Reads the current version of each annotation first. */
export const applyCommand: CommandApplier = async (command, direction) => {
  const toDelete = direction === 'undo' ? command.created : command.deleted;
  const toRestore = direction === 'undo' ? command.deleted : command.created;
  for (const a of toDelete) await setDeleted(a, true);
  for (const a of toRestore) await setDeleted(a, false);
};

function record(key: string | null, command: AnnotationCommand): void {
  if (key !== null) pushCommand(key, command);
}

/** Saves new annotations as one undoable action. */
export function addAnnotations(created: readonly Annotation[], historyKey: string | null): Promise<void> {
  return runExclusive(async () => {
    for (const a of created) await saveEntity('annotations', a);
    record(historyKey, { created, deleted: [] });
  });
}

/** Deletes annotations and saves replacements (partial eraser) as one undoable action. */
export function replaceAnnotations(deleted: readonly Annotation[], created: readonly Annotation[], historyKey: string | null): Promise<void> {
  return runExclusive(async () => {
    const snapshots: Annotation[] = [];
    for (const a of deleted) snapshots.push(await setDeleted(a, true));
    for (const a of created) await saveEntity('annotations', a);
    record(historyKey, { created, deleted: snapshots });
  });
}

export async function addTextHighlight(h: Omit<TextHighlight, 'id' | 'type' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<TextHighlight> {
  const now = Date.now();
  const highlight: TextHighlight = { ...h, id: newId(), type: 'highlight', createdAt: now, updatedAt: now, deletedAt: null };
  await addAnnotations([highlight], historyKeyFor(highlight));
  return highlight;
}

/** Text boxes of a page of the original view, oldest first. */
export function useTextBoxes(documentId: Id, childId: Id, pageIndex: number): TextBoxAnnotation[] {
  const all = useAnnotations(documentId, childId);
  return useMemo(
    () => all.filter((a): a is TextBoxAnnotation => a.type === 'textbox' && a.pageIndex === pageIndex).sort((x, y) => x.createdAt - y.createdAt),
    [all, pageIndex],
  );
}

export type TextBoxInput = Omit<TextBoxAnnotation, 'id' | 'type' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
export type TextBoxPatch = Partial<Pick<TextBoxAnnotation, 'text' | 'x' | 'y' | 'width' | 'fontSize' | 'color'>>;

/** New text box, as one undoable action. */
export async function addTextBox(input: TextBoxInput): Promise<TextBoxAnnotation> {
  const now = Date.now();
  const box: TextBoxAnnotation = { ...input, id: newId(), type: 'textbox', createdAt: now, updatedAt: now, deletedAt: null };
  await addAnnotations([box], historyKeyFor(box));
  return box;
}

/**
 * Text, place, size or colour of a text box. Not in the undo history (the text field has its own undo). Serialized with the
 * other annotation writes, so that a late save never brings back a box that was just removed.
 */
export function updateTextBox(id: Id, patch: TextBoxPatch): Promise<void> {
  return runExclusive(async () => {
    const current = await db.annotations.get(id);
    if (!current || current.type !== 'textbox' || current.deletedAt !== null) return;
    if ((Object.keys(patch) as (keyof TextBoxPatch)[]).every((k) => patch[k] === current[k])) return;
    await saveEntity('annotations', { ...current, ...patch, updatedAt: nextUpdatedAt(current.updatedAt) });
  });
}

/** Last text of a box the child leaves: saved, or the box disappears when it is empty (without an undo step). */
export function finishTextBox(id: Id, text: string): Promise<void> {
  return runExclusive(async () => {
    const current = await db.annotations.get(id);
    if (!current || current.type !== 'textbox' || current.deletedAt !== null) return;
    const updatedAt = nextUpdatedAt(current.updatedAt);
    if (text.trim() === '') await saveEntity('annotations', { ...current, text: '', deletedAt: updatedAt, updatedAt });
    else if (text !== current.text) await saveEntity('annotations', { ...current, text, updatedAt });
  });
}

export async function removeAnnotation(id: Id): Promise<void> {
  const existing = await db.annotations.get(id);
  if (!existing || existing.deletedAt !== null) return;
  await replaceAnnotations([existing], [], historyKeyFor(existing));
}

export interface PageTarget {
  documentId: Id;
  childId: Id;
  pageIndex: number;
  view: 'text' | 'original';
}

/** « Effacer la page »: every stroke of the page in this view (and the highlights in the text view), undoable. Returns the count. */
export function clearPageAnnotations(target: PageTarget): Promise<number> {
  return runExclusive(async () => {
    const all = await liveAnnotations(target.documentId, target.childId);
    const onPage = all.filter((a) => {
      if (annotationPageIndex(a) !== target.pageIndex) return false;
      if (a.type === 'highlight') return target.view === 'text';
      // Text boxes (§19.2) live on the original page.
      if (a.type === 'textbox') return target.view === 'original';
      return a.space.kind === target.view;
    });
    const snapshots: Annotation[] = [];
    for (const a of onPage) snapshots.push(await setDeleted(a, true));
    record(documentHistoryKey(target.documentId, target.childId), { created: [], deleted: snapshots });
    return snapshots.length;
  });
}

/** Clears the strokes of an answer box, undoable. Returns the count. */
export function clearAnswerInk(exerciseId: Id, questionId: string, childId: Id): Promise<number> {
  return runExclusive(async () => {
    const strokes = await getAnswerInk(exerciseId, questionId, childId);
    const snapshots: Annotation[] = [];
    for (const a of strokes) snapshots.push(await setDeleted(a, true));
    record(answerHistoryKey(exerciseId, questionId, childId), { created: [], deleted: snapshots });
    return snapshots.length;
  });
}
