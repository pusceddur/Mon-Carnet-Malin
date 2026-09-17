// Pure state helpers of the import form (ordered list of files / photos before import).
import type { ImportErrorCode } from '../ImportService';

export interface DraftItem {
  id: string;
  file: File;
  /** Display name (« Photo 2 » for camera shots). */
  name: string;
  kind: 'pdf' | 'image' | 'epub';
  /** null while a PDF / EPUB is being analyzed. */
  pageCount: number | null;
  previewUrl: string | null;
  error: ImportErrorCode | null;
}

export function moveItem<T extends { id: string }>(items: readonly T[], id: string, delta: -1 | 1): T[] {
  const from = items.findIndex((i) => i.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function removeItem<T extends { id: string }>(items: readonly T[], id: string): T[] {
  return items.filter((i) => i.id !== id);
}

export function updateItem<T extends { id: string }>(items: readonly T[], id: string, patch: Partial<T>): T[] {
  return items.map((i) => (i.id === id ? { ...i, ...patch } : i));
}

export function totalPages(items: readonly Pick<DraftItem, 'pageCount' | 'error'>[]): number {
  return items.reduce((sum, i) => sum + (i.error ? 0 : (i.pageCount ?? 0)), 0);
}

export type DraftProblem = 'title_required' | 'files_required' | 'has_errors' | 'epub_must_be_alone' | 'analyzing' | null;

/** An EPUB listed with any other file (the import would refuse it). */
export function isMixedEpub(items: readonly { kind?: DraftItem['kind'] }[]): boolean {
  return items.length > 1 && items.some((i) => i.kind === 'epub');
}

export function draftProblem(title: string, items: readonly (Pick<DraftItem, 'pageCount' | 'error'> & { kind?: DraftItem['kind'] })[]): DraftProblem {
  if (items.length === 0) return 'files_required';
  if (items.some((i) => i.error !== null)) return 'has_errors';
  if (isMixedEpub(items)) return 'epub_must_be_alone';
  if (items.some((i) => i.pageCount === null)) return 'analyzing';
  if (title.trim().length === 0) return 'title_required';
  return null;
}
