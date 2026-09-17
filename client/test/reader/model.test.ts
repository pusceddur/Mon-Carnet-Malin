import { normalizeForMatch, sha256Hex } from '@aide/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  blockHash,
  buildBlockModel,
  buildPageModel,
  buildSpeechItems,
  extendToNextWord,
  extendToPreviousWord,
  findQuote,
  highlightColorsForBlock,
  highlightsInRange,
  isSingleWord,
  isWholeParagraph,
  isWholeSentence,
  layoutKeyOf,
  pagesInput,
  paragraphRange,
  parseSpeechItemId,
  rangeText,
  readerPath,
  resolveHighlights,
  resolveInitialPage,
  selectWord,
  sentenceRange,
  speechStartIndex,
  type BlockModel,
  type Reanchor,
} from '../../src/features/reader/model';
import { makeHighlight, makePage } from './fixtures';

vi.mock('@aide/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aide/shared')>();
  const text = await import('./sharedTextMock');
  return { ...actual, tokenizeWords: text.tokenizeWordsForTest, segmentSentences: text.segmentSentencesForTest };
});

const TEXT = 'La photosynthèse nourrit la plante.  Le soleil brille ! Un arc-en-ciel apparaît';

function block(text = TEXT): BlockModel {
  return buildBlockModel(3, 1, { kind: 'paragraph', text }, 'hash');
}

function flatten(model: BlockModel): string {
  return model.segments
    .map((s) => (s.kind === 'gap' ? s.text : s.sentence.parts.map((p) => (p.kind === 'text' ? p.text : p.word.text)).join('')))
    .join('');
}

describe('block model', () => {
  it('splits a block into sentences and words without losing a character', () => {
    const model = block();
    expect(flatten(model)).toBe(TEXT);
    expect(model.sentences.map((s) => s.text)).toEqual(['La photosynthèse nourrit la plante.', 'Le soleil brille !', 'Un arc-en-ciel apparaît']);
    expect(model.sentences.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(model.words.slice(0, 2)).toEqual([{ offset: 0, end: 2, text: 'La' }, { offset: 3, end: 16, text: 'photosynthèse' }]);
    expect(model.words.find((w) => w.text === 'arc-en-ciel')?.offset).toBe(TEXT.indexOf('arc-en-ciel'));
    for (const word of model.words) expect(TEXT.slice(word.offset, word.end)).toBe(word.text);
  });

  it('keeps words that the segmenter left outside every sentence', async () => {
    const shared = await import('@aide/shared');
    const spy = vi.spyOn(shared, 'segmentSentences').mockReturnValueOnce([{ start: 0, end: 9 }]);
    const model = buildBlockModel(0, 0, { kind: 'paragraph', text: 'Bonjour. et voilà' }, 'h');
    spy.mockRestore();
    const words = model.sentences.flatMap((s) => s.words.map((w) => w.text));
    expect(words).toEqual(['Bonjour', 'et', 'voilà']);
    expect(flatten(model)).toBe('Bonjour. et voilà');
  });

  it('hashes blocks as sha256(normalizeForMatch(text)) and builds page models only for readable pages', async () => {
    expect(await blockHash('Le Chat !')).toBe(await sha256Hex(normalizeForMatch('Le Chat !')));
    const ready = await buildPageModel(makePage(0, ['Le chat dort.']));
    expect(ready.blocks[0]?.hash).toBe(await sha256Hex('le chat dort'));
    const pending = await buildPageModel(makePage(1, ['Pas encore.'], { status: 'processing' }));
    expect(pending.blocks).toEqual([]);
  });
});

describe('speech items', () => {
  it('one item per sentence with words, readable pages only, ids page:block:sentence', async () => {
    const pages = await Promise.all([
      buildPageModel(makePage(1, ['Deux. Trois.'])),
      buildPageModel(makePage(0, [{ kind: 'title', text: 'Titre' }, '…'])),
      buildPageModel(makePage(2, ['Caché.'], { status: 'failed' })),
      buildPageModel(makePage(3, ['Peut-être mal lu.'], { status: 'low_confidence' })),
    ]);
    const items = buildSpeechItems(pages);
    expect(items).toEqual([
      { id: '0:0:0', text: 'Titre' },
      { id: '1:0:0', text: 'Deux.' },
      { id: '1:0:1', text: 'Trois.' },
      { id: '3:0:0', text: 'Peut-être mal lu.' },
    ]);
    expect(parseSpeechItemId('12:3:4')).toEqual({ pageIndex: 12, blockIndex: 3, sentenceIndex: 4 });
    expect(parseSpeechItemId('x')).toBeNull();
    expect(speechStartIndex(items, { pageIndex: 1, blockIndex: 0, sentenceIndex: 1 })).toBe(2);
    expect(speechStartIndex(items, { pageIndex: 2 })).toBe(3);
    expect(speechStartIndex(items, { pageIndex: 9 })).toBe(3);
  });
});

describe('selection', () => {
  it('selects a word and extends it word by word, to the sentence and to the paragraph', () => {
    const model = block();
    const word = selectWord(model, 5);
    expect(word).toEqual({ pageIndex: 3, blockIndex: 1, start: 3, end: 16 });
    if (!word) return;
    expect(isSingleWord(model, word)).toBe(true);
    const wider = extendToNextWord(model, extendToPreviousWord(model, word));
    expect(rangeText(model, wider)).toBe('La photosynthèse nourrit');
    expect(isSingleWord(model, wider)).toBe(false);
    expect(extendToPreviousWord(model, wider)).toEqual(wider);

    const sentence = sentenceRange(model, word);
    expect(rangeText(model, sentence)).toBe('La photosynthèse nourrit la plante.');
    expect(isWholeSentence(model, sentence)).toBe(true);
    const across = sentenceRange(model, { ...word, end: TEXT.indexOf('soleil') + 2 });
    expect(rangeText(model, across)).toBe('La photosynthèse nourrit la plante.  Le soleil brille !');

    const paragraph = paragraphRange(model);
    expect(rangeText(model, paragraph)).toBe(TEXT);
    expect(isWholeParagraph(model, paragraph)).toBe(true);
    expect(selectWord(model, 2)).toBeNull();
  });
});

describe('quotes', () => {
  const blocks = [
    buildBlockModel(0, 0, { kind: 'title', text: 'Les plantes' }, 'a'),
    buildBlockModel(0, 1, { kind: 'paragraph', text: 'Grâce à la lumière du Soleil, la plante fabrique du sucre. Elle rejette de l’oxygène dans l’air qui nous entoure chaque jour.' }, 'b'),
  ];

  it('finds a quote despite case, accents, punctuation and spacing differences', () => {
    const range = findQuote(blocks, 'grace a la lumiere du soleil la plante');
    expect(range).toMatchObject({ pageIndex: 0, blockIndex: 1, start: 0 });
    if (!range || !blocks[1]) return;
    expect(rangeText(blocks[1], range)).toBe('Grâce à la lumière du Soleil, la plante');
  });

  it('matches long quotes by their first and last words (OCR noise in the middle)', () => {
    const range = findQuote(blocks, 'Elle rejette de l’oxygène dans l’aie qui nous entoure chaque jour');
    expect(range).not.toBeNull();
    if (!range || !blocks[1]) return;
    expect(rangeText(blocks[1], range)).toBe('Elle rejette de l’oxygène dans l’air qui nous entoure chaque jour');
    expect(findQuote(blocks, 'un passage absent du texte')).toBeNull();
    expect(findQuote(blocks, '   ')).toBeNull();
  });
});

describe('highlights', () => {
  it('keeps highlights on unchanged blocks, re-anchors changed ones and drops orphans', async () => {
    const page = await buildPageModel(makePage(0, ['Le chat dort.', 'Le chien joue.']));
    const hash0 = page.blocks[0]?.hash ?? '';
    const reanchor = vi.fn<Reanchor>((anchor) => (anchor.text === 'chien' ? { blockIndex: 1, start: 3, end: 8 } : 'orphan'));
    const resolved = resolveHighlights(page, [
      makeHighlight({ id: 'a', blockIndex: 0, start: 3, end: 7, blockTextHash: hash0, text: 'chat', createdAt: 2 }),
      makeHighlight({ id: 'b', blockIndex: 1, start: 0, end: 5, blockTextHash: 'old', text: 'chien', createdAt: 1 }),
      makeHighlight({ id: 'c', blockIndex: 1, start: 0, end: 2, blockTextHash: 'old', text: 'perdu', createdAt: 3 }),
      makeHighlight({ id: 'd', pageIndex: 4, blockTextHash: hash0 }),
      makeHighlight({ id: 'e', blockTextHash: hash0, deletedAt: 5 }),
    ], reanchor);
    expect(resolved.map((h) => [h.id, h.blockIndex, h.start, h.end])).toEqual([['b', 1, 3, 8], ['a', 0, 3, 7]]);
    expect(reanchor).toHaveBeenCalledTimes(2);

    const block0 = page.blocks[0];
    if (!block0) return;
    const colors = highlightColorsForBlock(block0, [
      { id: 'x', color: '#fde047', blockIndex: 0, start: 0, end: 7, createdAt: 1 },
      { id: 'y', color: '#86efac', blockIndex: 0, start: 3, end: 12, createdAt: 2 },
    ]);
    expect([...colors.entries()]).toEqual([[0, '#fde047'], [3, '#86efac'], [8, '#86efac']]);
    expect(highlightsInRange(resolved, { pageIndex: 0, blockIndex: 0, start: 4, end: 5 }).map((h) => h.id)).toEqual(['a']);
  });
});

describe('navigation and AI inputs', () => {
  it('resolves the initial page from ?page (1-based), then the saved progress', () => {
    expect(resolveInitialPage({ urlPage: '3', progressPage: 7, pageCount: 10 })).toBe(2);
    expect(resolveInitialPage({ urlPage: '99', progressPage: null, pageCount: 10 })).toBe(9);
    expect(resolveInitialPage({ urlPage: 'abc', progressPage: 7, pageCount: 10 })).toBe(7);
    expect(resolveInitialPage({ urlPage: null, progressPage: 12, pageCount: 10 })).toBe(9);
    expect(resolveInitialPage({ urlPage: '0', progressPage: null, pageCount: 0 })).toBe(0);
    expect(readerPath('doc 1', { pageIndex: 2, quote: 'La plante « verte »' })).toBe('/lire/doc%201?page=3&quote=La+plante+%C2%AB+verte+%C2%BB');
    expect(readerPath('d')).toBe('/lire/d');
  });

  it('builds page inputs around the current page within the character budget', async () => {
    const pages = [
      makePage(0, ['a'.repeat(50)]),
      makePage(1, ['b'.repeat(50)], { status: 'low_confidence', contentHash: 'f'.repeat(64) }),
      makePage(2, ['c'.repeat(50)]),
      makePage(3, ['d'.repeat(50)], { status: 'pending' }),
    ];
    const inputs = await pagesInput(pages, 120, 2);
    expect(inputs.map((p) => p.pageIndex)).toEqual([1, 2]);
    expect(inputs[0]).toMatchObject({ contentHash: 'f'.repeat(64), ocrLowConfidence: true });
    expect(inputs[1]?.contentHash).toBe(await sha256Hex(normalizeForMatch('c'.repeat(50))));
  });

  it('layoutKey changes with reading preferences and viewport width', () => {
    const prefs = { font: 'lexend', fontSizePx: 24, lineHeight: 1.8, letterSpacingEm: 0.04, wordSpacingEm: 0.16, columnWidthEm: 30, layoutMode: 'page' };
    expect(layoutKeyOf(prefs, 1024)).not.toBe(layoutKeyOf({ ...prefs, fontSizePx: 26 }, 1024));
    expect(layoutKeyOf(prefs, 1024)).not.toBe(layoutKeyOf(prefs, 768));
  });
});
