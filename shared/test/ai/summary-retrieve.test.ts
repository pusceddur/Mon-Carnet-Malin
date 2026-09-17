import { describe, expect, it } from 'vitest';
import { extractiveSummary } from '../../src/ai/extractiveSummary';
import { countWords } from '../../src/ai/limits';
import { retrieveRelevantParagraphs } from '../../src/ai/retrieve';
import { LIMITS } from '../../src/constants';
import { SummaryDataSchema } from '../../src/schemas/ai';
import { normalizeForMatch } from '../../src/text/normalize';
import type { SummaryLevel } from '../../src/types/ai';
import { HISTOIRE_PAGES, VOLCANS_PAGES, pageInput } from '../fixtures/texts';

const PARAGRAPH_BREAK = '\n\n';

describe('extractiveSummary', () => {
  const levels: SummaryLevel[] = ['bref', 'normal', 'detaille'];

  it.each(levels)('uses only original sentences, in reading order (%s)', (level) => {
    const data = extractiveSummary(VOLCANS_PAGES, level);
    expect(SummaryDataSchema.safeParse(data).success).toBe(true);
    expect(data.sourceRefs.length).toBeGreaterThan(0);
    expect(data.sourceRefs.length).toBeLessThanOrEqual(LIMITS.localSummarySentences[level]);
    let lastPosition = -1;
    for (const ref of data.sourceRefs) {
      const page = VOLCANS_PAGES.find((p) => p.pageIndex === ref.pageIndex)!;
      const position = page.pageIndex * 10_000 + page.text.indexOf(ref.quote);
      expect(page.text.includes(ref.quote)).toBe(true);
      expect(position).toBeGreaterThan(lastPosition);
      lastPosition = position;
    }
    expect(data.summary).toBe(data.sourceRefs.map((r) => r.quote.replace(/\s+/g, ' ')).join(' '));
    expect(countWords(data.summary)).toBeLessThanOrEqual(LIMITS.summaryMaxWords[level]);
  });

  it('picks more sentences for longer levels', () => {
    const bref = extractiveSummary(VOLCANS_PAGES, 'bref');
    const normal = extractiveSummary(VOLCANS_PAGES, 'normal');
    const detaille = extractiveSummary(VOLCANS_PAGES, 'detaille');
    expect(bref.sourceRefs).toHaveLength(3);
    expect(normal.sourceRefs).toHaveLength(6);
    expect(detaille.sourceRefs.length).toBeGreaterThan(normal.sourceRefs.length);
  });

  it('prefers sentences with the most frequent content words', () => {
    const data = extractiveSummary(VOLCANS_PAGES, 'bref');
    const text = normalizeForMatch(data.summary);
    expect(text).toContain('volcan');
    expect(data.sourceRefs.some((r) => /lave/.test(r.quote))).toBe(true);
  });

  it('never uses the title or a question as a summary sentence', () => {
    const data = extractiveSummary(VOLCANS_PAGES, 'detaille');
    expect(data.sourceRefs.some((r) => r.quote === 'Les volcans')).toBe(false);
    const story = extractiveSummary(HISTOIRE_PAGES, 'detaille');
    expect(story.sourceRefs.some((r) => r.quote.includes('?'))).toBe(false);
  });

  it('keeps key points short and taken from the summary', () => {
    const data = extractiveSummary(HISTOIRE_PAGES, 'normal');
    expect(data.keyPoints.length).toBeGreaterThan(0);
    expect(data.keyPoints.length).toBeLessThanOrEqual(LIMITS.keyPointsMax);
    for (const point of data.keyPoints) {
      expect(countWords(point)).toBeLessThanOrEqual(LIMITS.keyPointMaxWords);
      expect(data.summary.includes(point)).toBe(true);
    }
  });

  it('is deterministic', () => {
    expect(extractiveSummary(HISTOIRE_PAGES, 'normal')).toEqual(extractiveSummary(HISTOIRE_PAGES, 'normal'));
  });

  it('handles empty or very short texts', () => {
    expect(extractiveSummary([], 'bref')).toEqual({ summary: '', keyPoints: [], sourceRefs: [] });
    expect(extractiveSummary([pageInput(0, '   ')], 'bref')).toEqual({ summary: '', keyPoints: [], sourceRefs: [] });
    const tiny = extractiveSummary([pageInput(0, 'Bonjour')], 'bref');
    expect(tiny.sourceRefs).toEqual([{ pageIndex: 0, quote: 'Bonjour' }]);
  });

  it('stays within the word limit even with long sentences', () => {
    const long = Array.from({ length: 12 }, (_, i) =>
      `Le grand fleuve ${i} traverse lentement la plaine fertile où les paysans cultivent le blé, le maïs, les tomates et les pommes de terre depuis de très nombreuses générations.`).join(' ');
    const data = extractiveSummary([pageInput(0, long)], 'bref');
    expect(countWords(data.summary)).toBeLessThanOrEqual(LIMITS.summaryMaxWords.bref);
    expect(data.sourceRefs.length).toBeGreaterThan(0);
  });
});

describe('retrieveRelevantParagraphs', () => {
  it('returns the pages unchanged when everything fits', () => {
    const result = retrieveRelevantParagraphs(VOLCANS_PAGES, 'Pourquoi la terre est fertile ?');
    expect(result).toEqual(VOLCANS_PAGES);
    expect(result[0]).not.toBe(VOLCANS_PAGES[0]);
  });

  it('keeps the most relevant paragraphs within the budget, in reading order', () => {
    const question = 'Pourquoi la terre est-elle fertile autour des volcans ?';
    const result = retrieveRelevantParagraphs(VOLCANS_PAGES, question, 200);
    const total = result.reduce((n, p) => n + p.text.length, 0);
    expect(total).toBeLessThanOrEqual(200);
    const fertile = result.find((p) => p.text.includes('fertile'));
    expect(fertile?.pageIndex).toBe(1);
    expect(fertile?.contentHash).toBe(VOLCANS_PAGES[1]!.contentHash);
    expect(fertile?.text).toBe(VOLCANS_PAGES[1]!.text.split(PARAGRAPH_BREAK)[1]);
    expect(result.map((p) => p.pageIndex)).toEqual([...result.map((p) => p.pageIndex)].sort((a, b) => a - b));
  });

  it('adds neighbouring paragraphs when the budget allows it', () => {
    const question = 'Que font les scientifiques ?';
    const result = retrieveRelevantParagraphs(VOLCANS_PAGES, question, 450);
    const joined = result.map((p) => p.text).join('\n\n');
    expect(joined).toContain('scientifiques');
    expect(joined.length).toBeLessThanOrEqual(450 + 2 * result.length);
    expect(result.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(450);
    const order = result.map((p) => p.pageIndex);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('matches inflected forms through light stems', () => {
    const result = retrieveRelevantParagraphs(HISTOIRE_PAGES, 'Qu’est-ce que le renard a découvert près du ruisseau ?', 250);
    expect(result.map((p) => p.text).join(' ')).toContain('cabane abandonnée');
  });

  it('returns the beginning of the text when nothing matches', () => {
    const result = retrieveRelevantParagraphs(VOLCANS_PAGES, 'xyz', 150);
    expect(result).toHaveLength(1);
    expect(result[0]!.pageIndex).toBe(0);
    expect(result[0]!.text.startsWith(`Les volcans${PARAGRAPH_BREAK}Un volcan est`)).toBe(true);
    expect(result[0]!.text.length).toBeLessThanOrEqual(150);
  });

  it('cuts a single oversize paragraph to the budget', () => {
    const big = pageInput(0, 'mot '.repeat(500).trim());
    const result = retrieveRelevantParagraphs([big], 'mot', 100);
    expect(result).toHaveLength(1);
    expect(result[0]!.text.length).toBeLessThanOrEqual(100);
  });

  it('splits long paragraphs without blank lines into sentence groups', () => {
    const sentences = Array.from({ length: 60 }, (_, i) => (i === 42 ? 'Le trésor est caché sous le vieux chêne.' : `Phrase numéro ${i} sans intérêt particulier pour la question.`));
    const result = retrieveRelevantParagraphs([pageInput(7, sentences.join(' '))], 'Où est caché le trésor ?', 1200);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toContain('Le trésor est caché sous le vieux chêne.');
    expect(result[0]!.text.length).toBeLessThanOrEqual(1200);
  });

  it('handles empty input and zero budget', () => {
    expect(retrieveRelevantParagraphs([], 'question')).toEqual([]);
    expect(retrieveRelevantParagraphs(VOLCANS_PAGES, 'volcan', 0)).toEqual([]);
  });

  it('is deterministic', () => {
    expect(retrieveRelevantParagraphs(HISTOIRE_PAGES, 'livres', 300)).toEqual(retrieveRelevantParagraphs(HISTOIRE_PAGES, 'livres', 300));
  });
});
