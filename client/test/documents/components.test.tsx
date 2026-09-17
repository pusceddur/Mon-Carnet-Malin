import type { PageContent } from '@aide/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/localDb';
import { isDoubtfulPage, pendingPage } from '../../src/documents/DocumentParser';
import { PageStatusNotice, pageNoticeKind } from '../../src/documents/PageStatusNotice';
import { leadingDonePages, ProcessingBanner } from '../../src/documents/ProcessingBanner';
import { draftProblem, moveItem, removeItem, totalPages, updateItem } from '../../src/documents/ui/importDraft';
import { pageStatusLabel } from '../../src/documents/ui/labels';
import { FULL_FRAME, moveCorner, QuadEditor } from '../../src/documents/ui/QuadEditor';
import { documents } from '../../src/i18n/fr/documents';
import { cleanup, keyDown, render, wait } from '../design/render';
import { clearDb, seedDocument } from './queueHarness';

const base = pendingPage('d', 0, 1);
const page = (patch: Partial<PageContent>): PageContent => ({ ...base, ...patch });

describe('PageStatusNotice', () => {
  afterEach(cleanup);

  it('maps page states to notices', () => {
    expect(pageNoticeKind(page({ status: 'pending' }))).toBe('preparing');
    expect(pageNoticeKind(page({ status: 'processing' }))).toBe('preparing');
    expect(pageNoticeKind(page({ status: 'low_confidence' }))).toBe('low_confidence');
    expect(pageNoticeKind(page({ status: 'failed' }))).toBe('failed');
    expect(pageNoticeKind(page({ status: 'failed', warnings: ['awaiting_ai'] }))).toBe('awaiting_ai');
    expect(pageNoticeKind(page({ status: 'ready', textSource: 'ocr-local', warnings: ['no_text_found'] }))).toBe('no_text');
    expect(pageNoticeKind(page({ status: 'ready', textSource: 'manual', warnings: ['manually_corrected'] }))).toBeNull();
    expect(pageNoticeKind(page({ status: 'ready', textSource: 'pdf-text' }))).toBeNull();
  });

  it('shows the child-friendly warning for a doubtful page and nothing for a ready page', async () => {
    const { container, rerender } = await render(<PageStatusNotice page={page({ status: 'low_confidence', warnings: ['low_confidence'] })} />);
    const notice = container.querySelector('[role="note"]');
    expect(notice?.textContent).toContain(documents.notice.lowConfidence);
    expect(notice?.textContent).toContain('⚠️');
    await rerender(<PageStatusNotice page={page({ status: 'pending' })} />);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(documents.notice.preparing);
    await rerender(<PageStatusNotice page={page({ status: 'ready', textSource: 'ocr-local' })} />);
    expect(container.textContent).toBe('');
  });

  it('a page waiting for the smart reading shows a calm waiting message, not the failure', async () => {
    const { container } = await render(<PageStatusNotice page={page({ status: 'failed', warnings: ['awaiting_ai'] })} />);
    const notice = container.querySelector('[role="status"]');
    expect(notice?.textContent).toContain(documents.notice.awaitingAi);
    expect(notice?.classList.contains('page-status-notice--awaiting_ai')).toBe(true);
    expect(container.textContent).not.toContain(documents.notice.failed);
    expect(isDoubtfulPage(page({ status: 'failed', warnings: ['awaiting_ai'] }))).toBe(true);
    expect(pageStatusLabel(page({ status: 'failed', warnings: ['awaiting_ai'] }), null)).toEqual({ emoji: '⏳', label: documents.awaitingAiStatus, tone: 'pending' });
    expect(pageStatusLabel(page({ status: 'failed' }), null).label).toBe(documents.status.failed);
  });
});

describe('ProcessingBanner', () => {
  beforeEach(clearDb);
  afterEach(cleanup);

  it('counts the leading pages that are done', () => {
    expect(leadingDonePages([
      { pageIndex: 1, status: 'ready' },
      { pageIndex: 0, status: 'low_confidence' },
      { pageIndex: 2, status: 'pending' },
      { pageIndex: 3, status: 'ready' },
    ])).toBe(2);
    expect(leadingDonePages([{ pageIndex: 0, status: 'processing' }])).toBe(0);
  });

  it('shows « Chapitre », the percentage and the available page, then disappears when done', async () => {
    const id = await seedDocument({ pages: 4 });
    await db.pages.update([id, 0], { status: 'ready' });
    await db.pages.update([id, 1], { status: 'ready' });
    const { container } = await render(<ProcessingBanner documentId={id} />);
    await wait(50);
    expect(container.textContent).toContain('Chapitre');
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(container.textContent).toContain('Page 2 disponible');
    expect(container.textContent).toContain(documents.banner.nextPages);

    await db.pages.update([id, 2], { status: 'ready' });
    await db.pages.update([id, 3], { status: 'failed' });
    await wait(50);
    expect(container.textContent).toBe('');
  });
});

describe('import draft', () => {
  const items = [
    { id: 'a', pageCount: 1, error: null },
    { id: 'b', pageCount: 3, error: null },
    { id: 'c', pageCount: null, error: null },
  ];

  it('moves, removes and updates items', () => {
    expect(moveItem(items, 'b', -1).map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(moveItem(items, 'c', 1).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(moveItem(items, 'a', -1).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(removeItem(items, 'b').map((i) => i.id)).toEqual(['a', 'c']);
    expect(updateItem(items, 'c', { pageCount: 2 })[2]).toEqual({ id: 'c', pageCount: 2, error: null });
  });

  it('totals pages and reports the first problem', () => {
    expect(totalPages(items)).toBe(4);
    expect(draftProblem('Titre', [])).toBe('files_required');
    expect(draftProblem('Titre', items)).toBe('analyzing');
    expect(draftProblem('Titre', [{ pageCount: 0, error: 'pdf_unreadable' }])).toBe('has_errors');
    expect(draftProblem('  ', [{ pageCount: 1, error: null }])).toBe('title_required');
    expect(draftProblem('Titre', [{ pageCount: 1, error: null }])).toBeNull();
  });
});

describe('QuadEditor', () => {
  afterEach(cleanup);

  it('clamps corners inside the image', () => {
    expect(moveCorner(FULL_FRAME, 2, 1.4, -0.2)).toEqual([[0, 0], [1, 0], [1, 0], [0, 1]]);
  });

  it('renders 4 labelled corner handles and moves a corner with the keyboard', async () => {
    let latest = FULL_FRAME;
    const { container } = await render(
      <QuadEditor imageUrl="blob:page" alt="Image de la page 1" quad={null} editing onChange={(q) => (latest = q)} />,
    );
    const handles = container.querySelectorAll<HTMLButtonElement>('.quad-editor__handle');
    expect(handles).toHaveLength(4);
    expect(handles[0]?.getAttribute('aria-label')).toContain(documents.editor.corners.topLeft);
    await keyDown(handles[0]!, 'ArrowRight');
    expect(latest[0]?.[0]).toBeCloseTo(0.01);
    expect(latest[1]).toEqual([1, 0]);
  });
});
