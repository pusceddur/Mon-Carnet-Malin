import { describe, expect, it } from 'vitest';
import { sha256HexSync } from '@aide/shared';
import { LocalProvider } from '../../src/ai/LocalProvider';
import { page, STORY_TEXT } from './helpers';

describe('LocalProvider', () => {
  const local = new LocalProvider();

  it('supports only summaries and questions', () => {
    expect(local.supports('summarize')).toBe(true);
    expect(local.supports('generate_questions')).toBe(true);
    for (const op of ['explain_word', 'explain_text', 'simplify_text', 'correct_answer', 'question_on_text', 'recognize_handwriting'] as const) {
      expect(local.supports(op)).toBe(false);
    }
  });

  it('chunk summaries always carry 1 to 3 verbatim key quotes from the chunk', () => {
    const chunk = { chunkIndex: 2, pageIndexes: [7], text: STORY_TEXT, contentHash: sha256HexSync(STORY_TEXT) };
    const data = local.summarizeChunk(chunk, 'bref');
    expect(data.chunkIndex).toBe(2);
    expect(data.keyQuotes.length).toBeGreaterThanOrEqual(1);
    expect(data.keyQuotes.length).toBeLessThanOrEqual(3);
    for (const q of data.keyQuotes) {
      expect(q.pageIndex).toBe(7);
      expect(STORY_TEXT).toContain(q.quote);
    }
  });

  it('the final summary is the ordered union of the chunk summaries', () => {
    const final = local.summarizeFinal([
      { chunkIndex: 1, summary: 'Deuxième partie.', keyQuotes: [{ pageIndex: 1, quote: 'B' }] },
      { chunkIndex: 0, summary: 'Première partie.', keyQuotes: [{ pageIndex: 0, quote: 'A' }] },
    ]);
    expect(final.summary).toBe('Première partie.\n\nDeuxième partie.');
    expect(final.sourceRefs).toEqual([{ pageIndex: 0, quote: 'A' }, { pageIndex: 1, quote: 'B' }]);
    expect(final.keyPoints).toEqual(['Première partie.', 'Deuxième partie.']);
  });

  it('local questions are deterministic for the same pages', () => {
    const req = { pages: [page(0, STORY_TEXT)], count: 3 as const, types: ['qcm', 'ordre'] as ('qcm' | 'ordre')[] };
    expect(local.generateQuestions(req)).toEqual(local.generateQuestions(req));
  });
});
