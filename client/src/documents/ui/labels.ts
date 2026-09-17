// Display helpers shared by the parent document pages.
import type { DocumentStatus, PageContent, PageStatus } from '@aide/shared';
import { documents as t } from '../../i18n/fr/documents';

export const PAGE_STATUS_EMOJI: Readonly<Record<PageStatus, string>> = {
  pending: '⏳',
  processing: '⚙️',
  ready: '✅',
  low_confidence: '⚠️',
  failed: '❌',
};

export const DOCUMENT_STATUS_EMOJI: Readonly<Record<DocumentStatus, string>> = {
  processing: '⏳',
  ready: '✅',
  partial: '⚠️',
};

/**
 * Status shown for a page, « Lecture en cours » when the queue is on it right now. A failed page whose image waits for the
 * « lecture intelligente » (warning awaiting_ai) is shown as waiting, not as a failure.
 */
export function pageStatusLabel(page: Pick<PageContent, 'status' | 'pageIndex' | 'warnings'>, processingPageIndex: number | null): { emoji: string; label: string; tone: PageStatus } {
  const status: PageStatus = processingPageIndex === page.pageIndex && (page.status === 'pending' || page.status === 'failed') ? 'processing' : page.status;
  if (status === 'failed' && page.warnings.includes('awaiting_ai')) return { emoji: PAGE_STATUS_EMOJI.pending, label: t.awaitingAiStatus, tone: 'pending' };
  return { emoji: PAGE_STATUS_EMOJI[status], label: t.status[status], tone: status };
}

type JobErrorKey = keyof typeof t.jobErrors;

export function jobErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.prototype.hasOwnProperty.call(t.jobErrors, code) ? t.jobErrors[code as JobErrorKey] : null;
}

type EditorErrorKey = keyof typeof t.editor.errors;

export function editorErrorMessage(code: string): string {
  return Object.prototype.hasOwnProperty.call(t.editor.errors, code) ? t.editor.errors[code as EditorErrorKey] : t.editor.errors.failed;
}
