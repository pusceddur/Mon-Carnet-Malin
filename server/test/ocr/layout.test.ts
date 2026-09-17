import { buildBlocksFromLines, joinOcrLines } from '@aide/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { groupTextFlows, pageCharCount, pageConfidence, pageFromTesseract, pageToTextBlocks, type TessBlockLike } from '../../src/ocr/layout';

vi.mock('@aide/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aide/shared')>();
  return { ...actual, buildBlocksFromLines: vi.fn(actual.buildBlocksFromLines), joinOcrLines: vi.fn(actual.joinOcrLines) };
});

const word = (text: string, confidence = 90) => ({ text, confidence, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } });
const line = (top: number, words: ReturnType<typeof word>[], rowHeight = 30, x0 = 100, x1 = 900) => ({
  text: `${words.map((w) => w.text).join(' ')}\n`,
  bbox: { x0, y0: top, x1, y1: top + 32 },
  rowAttributes: { rowHeight, ascenders: 8, descenders: 6 },
  words,
});

/** Two columns as two engine blocks, plus a noise line made of punctuation. */
const TESS_BLOCKS: TessBlockLike[] = [
  {
    paragraphs: [
      { lines: [line(100, [word('La', 96), word('forêt', 92)], 60)] },
      { lines: [line(200, [word('Élodie', 88), word('marche')]), line(240, [word('lente-', 70), word('ment.', 70)]), line(280, [word('—', 20), word('|', 10)])] },
    ],
  },
  { paragraphs: [{ lines: [line(100, [word('Deuxième', 80), word('colonne.', 60)])] }] },
  { paragraphs: [{ lines: [line(900, [word('   ', 5)])] }] },
];

describe('pageFromTesseract', () => {
  it('keeps engine order, rebuilds line text from words and drops noise', () => {
    const page = pageFromTesseract(TESS_BLOCKS);
    expect(page.blocks).toHaveLength(2);
    const lines = page.blocks.flatMap((b) => b.paragraphs.flat());
    expect(lines.map((l) => l.text)).toEqual(['La forêt', 'Élodie marche', 'lente- ment.', 'Deuxième colonne.']);
    expect(lines[0]).toMatchObject({ top: 100, left: 100, width: 800, height: 32, rowHeight: 60 });
  });

  it('tolerates missing blocks', () => {
    expect(pageFromTesseract(null)).toEqual({ blocks: [] });
    expect(pageFromTesseract([{ paragraphs: null }, { paragraphs: [{ lines: null }] }])).toEqual({ blocks: [] });
  });
});

describe('confidence', () => {
  it('averages word confidences weighted by length', () => {
    const page = pageFromTesseract([{ paragraphs: [{ lines: [line(0, [word('a', 0), word('bbbb', 100)])] }] }]);
    expect(pageConfidence(page)).toBe(80);
    expect(pageCharCount(page)).toBe(5);
  });

  it('is 0 for an empty page', () => {
    expect(pageConfidence({ blocks: [] })).toBe(0);
  });
});

describe('groupTextFlows', () => {
  it('merges blocks stacked in one column (one block per line) into a single flow', () => {
    const stacked: TessBlockLike[] = [
      { paragraphs: [{ lines: [line(100, [word('Titre')], 60, 130, 500)] }] },
      { paragraphs: [{ lines: [line(200, [word('Première'), word('ligne')], 30, 128, 1800)] }] },
      { paragraphs: [{ lines: [line(240, [word('suite.')], 30, 129, 900)] }] },
    ];
    expect(groupTextFlows(pageFromTesseract(stacked)).map((f) => f.map((l) => l.text))).toEqual([['Titre', 'Première ligne', 'suite.']]);
  });

  it('keeps columns apart (block beside, or starting higher than the previous one)', () => {
    const columns: TessBlockLike[] = [
      { paragraphs: [{ lines: [line(100, [word('Gauche')], 30, 100, 900), line(140, [word('encore')], 30, 100, 900)] }] },
      { paragraphs: [{ lines: [line(100, [word('Droite')], 30, 1000, 1800)] }] },
      { paragraphs: [{ lines: [line(300, [word('Bas')], 30, 1000, 1800)] }] },
      { paragraphs: [{ lines: [line(400, [word('Encart')], 30, 100, 900)] }] },
    ];
    expect(groupTextFlows(pageFromTesseract(columns)).map((f) => f.map((l) => l.text))).toEqual([['Gauche', 'encore'], ['Droite', 'Bas'], ['Encart']]);
  });
});

describe('pageToTextBlocks', () => {
  beforeEach(() => {
    vi.mocked(buildBlocksFromLines).mockClear();
    vi.mocked(joinOcrLines).mockClear();
  });

  it('runs the shared layout heuristics per text flow so that columns never interleave', () => {
    const page = pageFromTesseract(TESS_BLOCKS);
    const blocks = pageToTextBlocks(page);
    expect(vi.mocked(buildBlocksFromLines)).toHaveBeenCalledTimes(2);
    const firstCall = vi.mocked(buildBlocksFromLines).mock.calls[0]?.[0];
    expect(firstCall?.[0]).toEqual({ text: 'La forêt', top: 100, left: 100, height: 32, fontSize: 60 });
    const text = blocks.map((b) => b.text).join(' ');
    expect(text.indexOf('La')).toBeLessThan(text.indexOf('Élodie'));
    expect(text.indexOf('Élodie')).toBeLessThan(text.indexOf('Deuxième'));
    expect(blocks.every((b) => b.text === b.text.trim() && !/\s{2}/.test(b.text))).toBe(true);
  });

  it('falls back to engine paragraphs joined with joinOcrLines', () => {
    vi.mocked(buildBlocksFromLines).mockReturnValue([]);
    vi.mocked(joinOcrLines).mockImplementation((lines: string[]) => lines.join(' ').replace('lente- ment', 'lentement'));
    const blocks = pageToTextBlocks(pageFromTesseract(TESS_BLOCKS));
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'La forêt' },
      { kind: 'paragraph', text: 'Élodie marche lentement.' },
      { kind: 'paragraph', text: 'Deuxième colonne.' },
    ]);
    vi.mocked(buildBlocksFromLines).mockReset();
  });
});
