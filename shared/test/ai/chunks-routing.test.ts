import { describe, expect, it } from 'vitest';
import { planChunks, planHash } from '../../src/ai/chunks';
import { countWords } from '../../src/ai/limits';
import { AI_DEADLINES, isAIOperationEnabled, routeFor } from '../../src/ai/routing';
import { DEFAULT_PARENT_SETTINGS, LIMITS } from '../../src/constants';
import { sha256Hex } from '../../src/hash/sha256';
import { TextChunkSchema } from '../../src/schemas/ai';
import type { AIOperation, AIPageInput } from '../../src/types/ai';
import type { ParentSettings } from '../../src/types/settings';

const HASH = 'f'.repeat(64);

function page(pageIndex: number, text: string): AIPageInput {
  return { pageIndex, text, contentHash: HASH, ocrLowConfidence: false };
}

function paragraph(seed: number, length: number): string {
  const words = ['Le', 'renard', 'court', 'dans', 'la', 'forêt', 'et', 'cherche', 'un', 'abri', 'pour', 'la', 'nuit'];
  let out = '';
  let i = seed;
  while (out.length < length) {
    out += `${words[i % words.length]} `;
    i++;
    if (i % 11 === 0) out = `${out.trimEnd()}. `;
  }
  return `${out.trim().replace(/\.$/, '')}.`;
}

describe('planChunks', () => {
  it('packs whole pages in order within the limit', async () => {
    const pages = [page(0, 'A'.repeat(2000)), page(1, 'B'.repeat(2000)), page(2, 'C'.repeat(2000)), page(3, 'D'.repeat(100))];
    const chunks = await planChunks(pages);
    expect(chunks.map((c) => c.pageIndexes)).toEqual([[0, 1], [2, 3]]);
    expect(chunks[0]!.text).toBe(`${'A'.repeat(2000)}\n\n${'B'.repeat(2000)}`);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
    for (const c of chunks) {
      expect(c.contentHash).toBe(await sha256Hex(c.text));
      expect(TextChunkSchema.safeParse(c).success).toBe(true);
    }
  });

  it('is deterministic', async () => {
    const pages = [page(0, paragraph(1, 3000)), page(1, paragraph(2, 5000)), page(2, paragraph(3, 900))];
    expect(await planChunks(pages)).toEqual(await planChunks(pages));
    expect(await planHash(await planChunks(pages))).toBe(await planHash(await planChunks(pages)));
  });

  it('splits an oversize page at paragraph boundaries, keeping the original text', async () => {
    const paragraphs = [paragraph(1, 2500), paragraph(2, 2500), paragraph(3, 2500)];
    const text = paragraphs.join('\n\n');
    const chunks = await planChunks([page(0, 'Court.'), page(4, text), page(5, 'Fin.')], 6000);
    expect(chunks.map((c) => c.pageIndexes)).toEqual([[0], [4], [4], [5]]);
    expect(chunks[1]!.text).toBe(`${paragraphs[0]}\n\n${paragraphs[1]}`);
    expect(chunks[2]!.text).toBe(paragraphs[2]);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(6000);
  });

  it('splits an oversize paragraph at sentences, then words', async () => {
    const longParagraph = paragraph(4, 9000);
    const chunks = await planChunks([page(2, longParagraph)], 1000);
    expect(chunks.length).toBeGreaterThan(8);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1000);
      expect(longParagraph.includes(c.text)).toBe(true);
    }
    const noSpaces = 'x'.repeat(2500);
    const hard = await planChunks([page(0, noSpaces)], 1000);
    expect(hard.map((c) => c.text.length)).toEqual([1000, 1000, 500]);
  });

  it('never exceeds the hard cap of a chunk text', async () => {
    const chunks = await planChunks([page(0, paragraph(5, 30_000))], 50_000);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(LIMITS.chunkTextMaxChars);
  });

  it('skips empty pages and trims page text', async () => {
    const chunks = await planChunks([page(0, '   '), page(1, '  Bonjour.  '), page(2, '')]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ chunkIndex: 0, pageIndexes: [1], text: 'Bonjour.' });
    expect(await planChunks([])).toEqual([]);
  });

  it('planHash is the sha256 of the ordered content hashes', async () => {
    const chunks = await planChunks([page(0, 'Un.'), page(1, 'Deux.')], 5);
    expect(chunks).toHaveLength(2);
    expect(await planHash(chunks)).toBe(await sha256Hex(chunks[0]!.contentHash + chunks[1]!.contentHash));
  });
});

describe('countWords', () => {
  it('counts words as a reader does', () => {
    expect(countWords('L’arbre, l’arc-en-ciel et 3,5 kg.')).toBe(5);
    expect(countWords('')).toBe(0);
    expect(countWords('« — » !')).toBe(0);
  });
});

describe('routing', () => {
  const settings = (patch: Partial<ParentSettings['ai']> = {}): Pick<ParentSettings, 'ai'> => ({ ai: { ...DEFAULT_PARENT_SETTINGS.ai, ...patch } });

  it('exposes the deadlines', () => {
    expect(AI_DEADLINES).toEqual({ light: 40_000, complex: 170_000 });
  });

  it('maps each feature flag to its operation', () => {
    const flags: [AIOperation, keyof ParentSettings['ai']['features']][] = [
      ['explain_word', 'explainWord'], ['explain_text', 'explainText'], ['simplify_text', 'simplify'], ['summarize', 'summarize'],
      ['generate_questions', 'questions'], ['correct_answer', 'correctAnswers'], ['question_on_text', 'questionOnText'],
    ];
    for (const [op, flag] of flags) {
      const off = settings({ features: { ...DEFAULT_PARENT_SETTINGS.ai.features, [flag]: false } });
      expect(isAIOperationEnabled(op, off)).toBe(false);
      expect(routeFor(op, 10, off)).toBe('local');
      expect(isAIOperationEnabled(op, settings())).toBe(true);
    }
  });

  it('routes long question_on_text requests to complex only with deep questions', () => {
    expect(routeFor('question_on_text', 50_000, settings())).toBe('light');
    expect(routeFor('question_on_text', 50_000, settings({ deepQuestions: true }))).toBe('complex');
    expect(routeFor('question_on_text', 50_000, settings({ deepQuestions: true, allowComplexModel: false }))).toBe('local');
  });
});
