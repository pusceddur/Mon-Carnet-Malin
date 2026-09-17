import type { Id, SourceRef } from '@aide/shared';

const QUOTE_MAX_CHARS = 300;

/**
 * Reader deep link. `page` is the 1-based page number shown to the child (« 📍 page N »), `quote` the passage to
 * find and highlight on that page.
 */
export function readerLink(documentId: Id, ref: SourceRef | null = null): string {
  const base = `/lire/${encodeURIComponent(documentId)}`;
  if (!ref) return base;
  const params = new URLSearchParams({ page: String(ref.pageIndex + 1) });
  const quote = ref.quote.trim().slice(0, QUOTE_MAX_CHARS);
  if (quote.length > 0) params.set('quote', quote);
  return `${base}?${params.toString()}`;
}

export function exercisesHomeLink(documentId?: Id): string {
  return documentId ? `/exercices?${new URLSearchParams({ livre: documentId }).toString()}` : '/exercices';
}

export function summaryLink(documentId: Id): string {
  return `/exercices/${encodeURIComponent(documentId)}/resume`;
}

export function questionsLink(documentId: Id): string {
  return `/exercices/${encodeURIComponent(documentId)}/questions`;
}

export function quizLink(exerciseId: Id): string {
  return `/exercices/quiz/${encodeURIComponent(exerciseId)}`;
}

const FINAL_PARAM = 'fin';

/** Value of `?q=` for a question index (1-based) or the result screen. */
export function questionParam(index: number, total: number): string {
  return index >= total ? FINAL_PARAM : String(index + 1);
}

/** Parses `?q=N` (1-based) or `?q=fin`; null when absent or invalid. */
export function parseQuestionParam(value: string | null, total: number): number | null {
  if (value === FINAL_PARAM) return total;
  const n = value === null ? Number.NaN : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= total ? n - 1 : null;
}
