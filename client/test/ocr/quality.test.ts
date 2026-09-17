import { afterEach, describe, expect, it, vi } from 'vitest';
import { tesseractPageToOcrResult } from '../../src/ocr/ocrLines';
import { isKnownToken, qualityFromBlocks, qualityFromOcrLines, scoreOcrQuality } from '../../src/ocr/quality';
import { createSortedWordList, loadFrenchWordList, resetWordListCache } from '../../src/ocr/wordList';

const WORDS = [
  'a', 'arbre', 'arc en ciel', 'aujourd hui', 'avec', 'chat', 'dans', 'de', 'eleve', 'foret', 'fille', 'jardin', 'la', 'le',
  'lecon', 'lit', 'livre', 'petite', 'pres', 'son', 'un',
].sort();
const list = createSortedWordList(`${WORDS.join('\n')}\n`);

describe('sorted word list', () => {
  it('finds every word and nothing else', () => {
    expect(list.size).toBe(WORDS.length);
    for (const w of WORDS) expect(list.has(w)).toBe(true);
    for (const w of ['', 'b', 'chats', 'zzz', 'aa', 'arc']) expect(list.has(w)).toBe(false);
  });

  it('tolerates CRLF files and blank lines', () => {
    const crlf = createSortedWordList('chat\r\n\r\nlivre\r\n');
    expect(crlf.has('chat')).toBe(true);
    expect(crlf.has('livre')).toBe(true);
  });

  it('loads mots-fr.txt once and retries after a failure', async () => {
    resetWordListCache();
    const failing = vi.fn(async () => new Response('', { status: 404 }));
    expect(await loadFrenchWordList(failing as unknown as typeof fetch)).toBeNull();
    const ok = vi.fn(async () => new Response('chat\nlivre\n'));
    const loaded = await loadFrenchWordList(ok as unknown as typeof fetch);
    expect(loaded?.has('livre')).toBe(true);
    await loadFrenchWordList(ok as unknown as typeof fetch);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  afterEach(() => resetWordListCache());
});

describe('isKnownToken', () => {
  it('normalizes accents, accepts elisions, numbers and compounds', () => {
    expect(isKnownToken('Forêt', list)).toBe(true);
    expect(isKnownToken('l’', list)).toBe(true);
    expect(isKnownToken("qu'", list)).toBe(true);
    expect(isKnownToken('1789', list)).toBe(true);
    expect(isKnownToken('3,5', list)).toBe(true);
    expect(isKnownToken('arc-en-ciel', list)).toBe(true);
    expect(isKnownToken('fille-chat', list)).toBe(true);
    expect(isKnownToken('f1lle', list)).toBe(false);
    expect(isKnownToken('xq’', list)).toBe(false);
  });
});

describe('scoreOcrQuality', () => {
  const words = (text: string, confidence: number) => text.split(' ').map((t) => ({ text: t, confidence }));

  it('scores a clean French reading high', () => {
    const text = 'La petite fille lit un livre dans le jardin avec son chat.';
    const report = scoreOcrQuality({ text, words: words(text, 93) }, list);
    expect(report.score).toBeGreaterThanOrEqual(85);
    expect(report.dictionaryRatio).toBe(1);
    expect(report.lowConfidenceRatio).toBe(0);
    expect(report.noiseRatio).toBe(0);
  });

  it('scores garbage low (below the default threshold of 70)', () => {
    const text = 'Lz p|tite f1lle ~~ l1t vn l|vre d@ns {e j@rdin';
    const report = scoreOcrQuality({ text, words: words(text, 48) }, list);
    expect(report.score).toBeLessThan(70);
    expect(report.noiseRatio).toBeGreaterThan(0);
    expect(report.lowConfidenceRatio).toBe(1);
  });

  it('good engine confidence alone cannot hide non-words', () => {
    const text = 'Qzxv brtl mnopq sdfgh wxcvb';
    expect(scoreOcrQuality({ text, words: words(text, 90) }, list).score).toBeLessThan(70);
  });

  it('works without a word list and without word confidences', () => {
    const text = 'La petite fille lit un livre.';
    const noList = scoreOcrQuality({ text, words: words(text, 90) }, null);
    expect(noList.dictionaryRatio).toBeNull();
    expect(noList.score).toBeGreaterThan(80);
    const server = qualityFromBlocks([{ kind: 'paragraph', text }], 91, list);
    expect(server.meanConfidence).toBe(91);
    expect(server.lowConfidenceRatio).toBeNull();
    expect(server.score).toBeGreaterThan(85);
  });

  it('returns 0 without text and stays cautious with very little text', () => {
    expect(scoreOcrQuality({ text: '  ', words: [] }, list).score).toBe(0);
    const short = scoreOcrQuality({ text: 'chat', words: [{ text: 'chat', confidence: 95 }] }, list);
    expect(short.score).toBeLessThan(90);
  });
});

describe('tesseract output conversion', () => {
  it('visits blocks → paragraphs → lines → words and drops empty lines', () => {
    const page = {
      confidence: 87,
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                { text: 'Le chat\n', bbox: { x0: 10, y0: 20, x1: 200, y1: 44 }, words: [{ text: 'Le', confidence: 90 }, { text: 'chat', confidence: 80 }] },
                { text: ' \n', bbox: { x0: 0, y0: 50, x1: 1, y1: 51 }, words: [] },
              ],
            },
          ],
        },
        { paragraphs: [{ lines: [{ text: 'lit.\n', bbox: { x0: 12, y0: 60, x1: 90, y1: 80 }, words: [{ text: 'lit.', confidence: 120 }] }] }] },
      ],
    };
    const result = tesseractPageToOcrResult(page);
    expect(result.confidence).toBe(87);
    expect(result.lines).toEqual([
      { text: 'Le chat', top: 20, left: 10, height: 24, words: [{ text: 'Le', confidence: 90 }, { text: 'chat', confidence: 80 }] },
      { text: 'lit.', top: 60, left: 12, height: 20, words: [{ text: 'lit.', confidence: 100 }] },
    ]);
    expect(qualityFromOcrLines(result.lines, result.confidence, list).wordCount).toBe(3);
    expect(tesseractPageToOcrResult({ confidence: 0, blocks: null }).lines).toEqual([]);
  });
});
