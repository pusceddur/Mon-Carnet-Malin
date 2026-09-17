import type { PageContent } from '@aide/shared';
import type { JSX } from 'react';
import { documents as t } from '../i18n/fr/documents';
import './documents.css';

export type PageNoticeKind = 'preparing' | 'low_confidence' | 'awaiting_ai' | 'failed' | 'no_text' | null;

export function pageNoticeKind(page: Pick<PageContent, 'status' | 'warnings' | 'textSource'>): PageNoticeKind {
  switch (page.status) {
    case 'pending':
    case 'processing':
      return 'preparing';
    case 'failed':
      // Not read on the device but sent to the « lecture intelligente »: the text comes later with the sync (§17.7).
      return page.warnings.includes('awaiting_ai') ? 'awaiting_ai' : 'failed';
    case 'low_confidence':
      return 'low_confidence';
    case 'ready':
      if (page.textSource !== 'manual' && page.warnings.includes('low_confidence')) return 'low_confidence';
      if (page.warnings.includes('no_text_found')) return 'no_text';
      return null;
  }
}

const EMOJI: Record<Exclude<PageNoticeKind, null>, string> = {
  preparing: '⏳',
  low_confidence: '⚠️',
  awaiting_ai: '⏳',
  failed: '😕',
  no_text: '🖼️',
};

const MESSAGE: Record<Exclude<PageNoticeKind, null>, string> = {
  preparing: t.notice.preparing,
  low_confidence: t.notice.lowConfidence,
  awaiting_ai: t.notice.awaitingAi,
  failed: t.notice.failed,
  no_text: t.notice.noText,
};

/** ⚠️ low confidence / page not ready / waiting for the smart reading / failed notice for a page (nothing for a normal page). */
export function PageStatusNotice(props: { page: PageContent }): JSX.Element {
  const kind = pageNoticeKind(props.page);
  if (kind === null) return <></>;
  return (
    <div
      className={`page-status-notice page-status-notice--${kind}`}
      data-status={props.page.status}
      role={kind === 'preparing' || kind === 'awaiting_ai' ? 'status' : 'note'}
    >
      <span className="page-status-notice__emoji" aria-hidden="true">
        {EMOJI[kind]}
      </span>
      <span className="page-status-notice__text">{MESSAGE[kind]}</span>
    </div>
  );
}
