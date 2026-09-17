import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBlockHighlights,
  applySpeakingSentence,
  applyWordRangeClass,
  SEL_CLASS,
  wordElementFromPoint,
  wordPosition,
} from '../../src/features/reader/decorations';
import { buildBlockModel } from '../../src/features/reader/model';
import { ReaderBlock } from '../../src/features/reader/ReaderBlock';
import { cleanup, render } from '../design/render';

vi.mock('@aide/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aide/shared')>();
  const text = await import('./sharedTextMock');
  return { ...actual, tokenizeWords: text.tokenizeWordsForTest, segmentSentences: text.segmentSentencesForTest };
});

describe('ReaderBlock DOM (§11.3)', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('renders exactly div.rp-block > span.rp-s[data-s] > span.rp-w[data-o]', async () => {
    const model = buildBlockModel(3, 0, { kind: 'paragraph', text: 'La photosynthèse… Oui !' }, 'abc123');
    const { container } = await render(<ReaderBlock block={model} />);
    expect(container.innerHTML).toBe(
      '<div class="rp-block" data-page-index="3" data-block-index="0" data-block-hash="abc123">'
      + '<span class="rp-s" data-s="0"><span class="rp-w" data-o="0">La</span> <span class="rp-w" data-o="3">photosynthèse</span>…</span>'
      + ' '
      + '<span class="rp-s" data-s="1"><span class="rp-w" data-o="18">Oui</span> !</span>'
      + '</div>',
    );
  });

  it('titles are headings; the spans are not remounted when the same block renders again', async () => {
    const model = buildBlockModel(0, 1, { kind: 'title', text: 'Chapitre un' }, 'h');
    const view = await render(<ReaderBlock block={model} />);
    const block = view.container.querySelector('.rp-block');
    expect(block?.getAttribute('role')).toBe('heading');
    const word = view.container.querySelector('.rp-w');
    word?.classList.add(SEL_CLASS);
    await view.rerender(<ReaderBlock block={buildBlockModel(0, 1, { kind: 'title', text: 'Chapitre un' }, 'h')} />);
    expect(view.container.querySelector('.rp-w')).toBe(word);
    expect(word?.classList.contains(SEL_CLASS)).toBe(true);
  });
});

describe('decorations', () => {
  afterEach(async () => {
    await cleanup();
  });

  async function mount(): Promise<HTMLElement> {
    const a = buildBlockModel(0, 0, { kind: 'paragraph', text: 'Le chat dort. Le chien joue.' }, 'a');
    const b = buildBlockModel(0, 1, { kind: 'paragraph', text: 'Il pleut.' }, 'b');
    const { container } = await render(<article className="reader"><section className="rp-page" data-page-index="0"><ReaderBlock block={a} /><ReaderBlock block={b} /></section></article>);
    return container;
  }

  it('sets data-hl and --hl on highlighted words and clears stale ones', async () => {
    const root = await mount();
    const blockEl = root.querySelector('.rp-block[data-block-index="0"]');
    if (!blockEl) throw new Error('block missing');
    applyBlockHighlights(blockEl, new Map([[3, '#fde047'], [8, '#86efac']]));
    const marked = Array.from(blockEl.querySelectorAll<HTMLElement>('[data-hl]'));
    expect(marked.map((w) => [w.textContent, w.getAttribute('data-hl'), w.style.getPropertyValue('--hl')])).toEqual([
      ['chat', '#fde047', '#fde047'],
      ['dort', '#86efac', '#86efac'],
    ]);
    applyBlockHighlights(blockEl, new Map([[3, '#fde047']]));
    expect(Array.from(blockEl.querySelectorAll('[data-hl]')).map((w) => w.textContent)).toEqual(['chat']);
  });

  it('marks the words of a range and moves the mark', async () => {
    const root = await mount();
    const first = applyWordRangeClass(root, SEL_CLASS, { pageIndex: 0, blockIndex: 0, start: 3, end: 12 });
    expect(first.map((w) => w.textContent)).toEqual(['chat', 'dort']);
    applyWordRangeClass(root, SEL_CLASS, { pageIndex: 0, blockIndex: 1, start: 0, end: 2 });
    expect(Array.from(root.querySelectorAll(`.${SEL_CLASS}`)).map((w) => w.textContent)).toEqual(['Il']);
    applyWordRangeClass(root, SEL_CLASS, null);
    expect(root.querySelectorAll(`.${SEL_CLASS}`)).toHaveLength(0);
  });

  it('marks the sentence being read and only that one', async () => {
    const root = await mount();
    const el = applySpeakingSentence(root, { pageIndex: 0, blockIndex: 0, sentenceIndex: 1 });
    expect(el?.textContent).toBe('Le chien joue.');
    applySpeakingSentence(root, { pageIndex: 0, blockIndex: 1, sentenceIndex: 0 });
    expect(Array.from(root.querySelectorAll('.rp-s--speaking')).map((s) => s.textContent)).toEqual(['Il pleut.']);
    expect(applySpeakingSentence(root, null)).toBeNull();
    expect(root.querySelectorAll('.rp-s--speaking')).toHaveLength(0);
  });

  it('finds the tapped word and its position', async () => {
    const root = await mount();
    const word = root.querySelectorAll('.rp-w')[4];
    const found = wordElementFromPoint({ elementFromPoint: () => null } as unknown as Document, 0, 0, word ?? null);
    expect(found).toBe(word);
    expect(found && wordPosition(found)).toEqual({ pageIndex: 0, blockIndex: 0, offset: 17 });
    expect(wordElementFromPoint({ elementFromPoint: () => root.querySelector('.rp-page') } as unknown as Document, 0, 0, null)).toBeNull();
  });
});
