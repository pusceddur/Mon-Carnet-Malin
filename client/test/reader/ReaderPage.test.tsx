import type { AuthStatus, DocumentMeta, TextHighlight } from '@aide/shared';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestAI } from '../../src/ai/aiClient';
import { db } from '../../src/db/localDb';
import ReaderPage from '../../src/features/reader/ReaderPage';
import { help } from '../../src/i18n/fr/help';
import { reader } from '../../src/i18n/fr/reader';
import { useSessionStore } from '../../src/state/session';
import { makeChild } from '../ai/helpers';
import { buttonByName, cleanup, click, render, wait } from '../design/render';
import { makePage } from './fixtures';

vi.mock('@aide/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aide/shared')>();
  const text = await import('./sharedTextMock');
  return { ...actual, tokenizeWords: text.tokenizeWordsForTest, segmentSentences: text.segmentSentencesForTest };
});

vi.mock('../../src/ai/aiClient', () => ({
  requestAI: vi.fn(async () => ({ status: 'unavailable', reason: 'offline', message: 'Pas de connexion pour le moment.', meta: null })),
  lookupDefinition: vi.fn(async () => ({ status: 'not_found' })),
  lookupLocalExplanation: vi.fn(async () => ({ headword: 'chat', definition: 'Un petit animal qui miaule.', example: null })),
  kidMessageForUnavailable: () => 'Indisponible',
  summarizeProgressively: vi.fn(),
}));

const doc: DocumentMeta = {
  id: 'doc-1', ownerParentId: 'parent-1', childIds: ['child-1'], title: 'Mon livre', kind: 'pdf', sourceHash: 'b'.repeat(64), pageCount: 3,
  status: 'processing', createdAt: 1, updatedAt: 1, deletedAt: null,
};

const authStatus: AuthStatus = {
  setupRequired: false, authenticated: true, parent: null, parentUnlockedUntil: null, pinSet: true, pinLockedUntil: null,
  registrationOpen: false,
};

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor: timeout');
    await wait(20);
  }
}

async function tap(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error('tap: element not found');
  await act(async () => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 5, clientY: 5 }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 5, clientY: 5 }));
  });
}

function mount(url: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/lire/:documentId" element={<ReaderPage />} />
        <Route path="/livres" element={<p>Mes livres</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const text = (): string => document.body.textContent ?? '';

describe('ReaderPage', () => {
  beforeEach(async () => {
    await Promise.all([db.documents.clear(), db.pages.clear(), db.annotations.clear(), db.progress.clear(), db.sessions.clear()]);
    await db.documents.put(doc);
    await db.pages.bulkPut([
      makePage(0, [{ kind: 'title', text: 'Le chat' }, 'Le chat dort. Il rêve.']),
      makePage(1, [], { status: 'processing' }),
      makePage(2, ['La pluie tombe sur la ville.'], { status: 'low_confidence', warnings: ['low_confidence'] }),
    ]);
    useSessionStore.setState({ authStatus, children: [makeChild()], selectedChildId: 'child-1', parentSettings: null });
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(() => {
    db.close();
  });

  it('renders the §11.3 structure, page header and page by page navigation over pages that are not ready', async () => {
    await mount('/lire/doc-1');
    await waitFor(() => document.querySelector('.rp-block') !== null);
    const article = document.querySelector('article.reader');
    expect(article?.getAttribute('data-document-id')).toBe('doc-1');
    expect(article?.querySelector(':scope > section.rp-page[data-page-index="0"] > .rp-block[data-block-index="1"] > .rp-s[data-s="1"] > .rp-w[data-o="14"]')?.textContent).toBe('Il');
    expect(document.querySelector('.rp-block')?.getAttribute('data-block-hash')).toMatch(/^[0-9a-f]{64}$/);
    expect(text()).toContain('Page 1 / 3');

    await click(buttonByName(reader.nav.nextLabel));
    expect(text()).toContain('Page 2 / 3');
    expect(document.querySelector('section.rp-page.rp-page--pending[data-page-index="1"]')).not.toBeNull();
    await click(buttonByName(reader.nav.nextLabel));
    await waitFor(() => document.querySelector('.rp-page[data-page-index="2"] .rp-w') !== null);
    expect(text()).toContain('Page 3 / 3');
    expect(buttonByName(reader.nav.nextLabel)?.disabled).toBe(true);
  });

  it('opens at ?page=N (1-based) and marks the ?quote passage', async () => {
    await mount('/lire/doc-1?page=3&quote=pluie%20tombe');
    await waitFor(() => document.querySelectorAll('.rp-w--quote').length > 0);
    expect(Array.from(document.querySelectorAll('.rp-w--quote')).map((w) => w.textContent)).toEqual(['pluie', 'tombe']);
    expect(text()).toContain('Page 3 / 3');
  });

  it('resumes at the saved reading position', async () => {
    await db.progress.put({ childId: 'child-1', documentId: 'doc-1', pageIndex: 2, blockIndex: 0, sentenceIndex: 0, updatedAt: 1 });
    await mount('/lire/doc-1');
    await waitFor(() => text().includes('Page 3 / 3'));
  });

  it('tap on a word → selection toolbar; 💡 Explique uses the local glossary first; 🖍️ Surligner saves a highlight', async () => {
    await mount('/lire/doc-1');
    await waitFor(() => document.querySelector('.rp-w') !== null);
    const chat = document.querySelector('.rp-block[data-block-index="1"] .rp-w[data-o="3"]');
    await tap(chat);
    expect(chat?.classList.contains('rp-w--sel')).toBe(true);
    expect(text()).toContain('« chat »');

    await click(buttonByName(`💡${reader.selection.explain}`) ?? buttonByName(reader.selection.explain) ?? Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(reader.selection.explain)));
    await waitFor(() => text().includes('Un petit animal qui miaule.'));
    expect(text()).toContain(help.moreHelp);
    await click(document.querySelector('.ui-sheet__close'));
    await wait(250);

    await click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(reader.selection.highlight)));
    await waitFor(() => document.querySelector('.rp-w[data-hl]') !== null);
    const saved = (await db.annotations.toArray()) as TextHighlight[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ type: 'highlight', pageIndex: 0, blockIndex: 1, start: 3, end: 7, text: 'chat', childId: 'child-1' });
    expect(saved[0]?.blockTextHash).toBe(document.querySelector('.rp-block[data-block-index="1"]')?.getAttribute('data-block-hash'));
    expect(document.querySelector('.rp-w[data-hl]')?.textContent).toBe('chat');
  });

  it('extends the selection to the whole sentence', async () => {
    await mount('/lire/doc-1');
    await waitFor(() => document.querySelector('.rp-w') !== null);
    await tap(document.querySelector('.rp-block[data-block-index="1"] .rp-w[data-o="8"]'));
    await click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === reader.selection.sentence));
    expect(Array.from(document.querySelectorAll('.rp-w--sel')).map((w) => w.textContent)).toEqual(['Le', 'chat', 'dort']);
  });

  it('continuous mode stacks every page with separators', async () => {
    const child = makeChild();
    useSessionStore.setState({ children: [{ ...child, reading: { ...child.reading, layoutMode: 'continu' } }] });
    await mount('/lire/doc-1');
    await waitFor(() => document.querySelectorAll('section.rp-page').length === 3);
    expect(document.querySelectorAll('.rp-sep')).toHaveLength(2);
    expect(buttonByName(reader.nav.nextLabel)).toBeNull();
  });

  it('saves the reading progress when leaving', async () => {
    const view = await mount('/lire/doc-1?page=3');
    await waitFor(() => text().includes('Page 3 / 3'));
    await view.unmount();
    await waitFor(() => false, 50).catch(() => undefined);
    const progress = await db.progress.get(['child-1', 'doc-1']);
    expect(progress).toMatchObject({ pageIndex: 2, blockIndex: 0, sentenceIndex: 0 });
  });

  it('❓ question on the text: one question ≤ 200 characters, answer with a link to the passage', async () => {
    vi.mocked(requestAI).mockResolvedValueOnce({
      status: 'ok',
      data: { answer: 'Il pleut sur la ville.', sourceRefs: [{ pageIndex: 2, quote: 'La pluie tombe sur la ville.' }] },
      meta: { cached: false, route: 'light', promptVersion: 'v', sourceWarning: true, requestId: 'r' },
    });
    await mount('/lire/doc-1');
    await waitFor(() => document.querySelector('.rp-w') !== null);
    await click(buttonByName(reader.header.menu));
    await click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === reader.menu.question));
    await waitFor(() => document.querySelector('textarea') !== null);
    const field = document.querySelector('textarea');
    expect(field?.maxLength).toBe(200);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(field, 'Quel temps fait-il ?');
      field?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === help.question.submit));
    await waitFor(() => text().includes('Il pleut sur la ville.'));
    expect(text()).toContain('⚠️');
    const call = vi.mocked(requestAI).mock.calls.at(-1) as unknown as [string, { question: string; pages: { pageIndex: number }[] }];
    expect(call[0]).toBe('question_on_text');
    expect(call[1].question).toBe('Quel temps fait-il ?');
    expect(call[1].pages.map((p) => p.pageIndex)).toEqual([0, 2]);

    await click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('page 3')));
    await waitFor(() => document.querySelectorAll('.rp-w--quote').length === 6);
    expect(text()).toContain('Page 3 / 3');
  });

  it('unknown book → friendly message', async () => {
    await mount('/lire/nope');
    await waitFor(() => text().includes(reader.notFound.title));
  });
});
