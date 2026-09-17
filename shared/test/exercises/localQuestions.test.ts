import { describe, expect, it } from 'vitest';
import { generateLocalQuestions } from '../../src/exercises/localQuestions';
import { ExerciseSchema, QuestionSchema } from '../../src/schemas/exercises';
import { normalizeForMatch } from '../../src/text/normalize';
import { tokenizeWords } from '../../src/text/tokenize';
import type { Question } from '../../src/types/exercises';
import { HISTOIRE_PAGES, VOLCANS_PAGES, pageInput } from '../fixtures/texts';

const PAGES = [...VOLCANS_PAGES, ...HISTOIRE_PAGES];

function pageText(pageIndex: number): string {
  return PAGES.find((p) => p.pageIndex === pageIndex)!.text;
}

describe('generateLocalQuestions', () => {
  it('produces valid questions quoting the text exactly', () => {
    const questions = generateLocalQuestions(PAGES, 10, ['qcm', 'ordre', 'vrai_faux'], 42);
    expect(questions.length).toBe(10);
    for (const q of questions) {
      expect(QuestionSchema.safeParse(q).success, JSON.stringify(q)).toBe(true);
      expect(pageText(q.source.pageIndex).includes(q.source.quote)).toBe(true);
    }
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    expect(ExerciseSchema.shape.questions.safeParse(questions).success).toBe(true);
  });

  it('is deterministic for a seed and varies with the seed', () => {
    const a = generateLocalQuestions(PAGES, 5, ['qcm', 'ordre', 'vrai_faux'], 7);
    const b = generateLocalQuestions(PAGES, 5, ['qcm', 'ordre', 'vrai_faux'], 7);
    expect(a).toEqual(b);
    const others = [1, 2, 3, 4, 5].map((seed) => JSON.stringify(generateLocalQuestions(PAGES, 5, ['qcm', 'ordre', 'vrai_faux'], seed)));
    expect(new Set(others).size).toBeGreaterThan(1);
    expect(generateLocalQuestions(PAGES, 3, ['qcm'])).toEqual(generateLocalQuestions(PAGES, 3, ['qcm'], 1));
  });

  it('builds « mot manquant » qcm with plausible distractors from the same text', () => {
    const questions = generateLocalQuestions(PAGES, 6, ['qcm'], 3).filter((q): q is Extract<Question, { type: 'qcm' }> => q.type === 'qcm');
    expect(questions.length).toBe(6);
    const vocabulary = new Set(PAGES.flatMap((p) => tokenizeWords(p.text).map((t) => t.word)));
    for (const q of questions) {
      expect(q.prompt.startsWith('Quel mot manque ? « ')).toBe(true);
      expect(q.prompt).toContain('_____');
      expect(q.choices.length).toBeGreaterThanOrEqual(3);
      expect(q.choices.length).toBeLessThanOrEqual(4);
      expect(new Set(q.choices.map(normalizeForMatch)).size).toBe(q.choices.length);
      const answer = q.choices[q.correctIndex]!;
      expect(q.prompt.replace('_____', answer)).toContain(q.source.quote.replace(/\s+/g, ' '));
      const sentenceWords = new Set(tokenizeWords(q.source.quote).map((t) => normalizeForMatch(t.word)));
      const answerLength = answer.length;
      for (const [i, choice] of q.choices.entries()) {
        expect(vocabulary.has(choice), choice).toBe(true);
        if (i === q.correctIndex) continue;
        expect(sentenceWords.has(normalizeForMatch(choice)), `${choice} in « ${q.source.quote} »`).toBe(false);
        const bucket = (n: number): number => (n <= 4 ? 0 : n <= 7 ? 1 : 2);
        expect(bucket(choice.length), `${choice} vs ${answer}`).toBe(bucket(answerLength));
        expect(/^\p{Ll}/u.test(choice)).toBe(true);
        // Keeps « l’ » / « la » correct before the blank.
        const vowel = (w: string): boolean => /^[aeiouy]/.test(normalizeForMatch(w));
        if (!normalizeForMatch(choice).startsWith('h')) expect(vowel(choice), `${choice} vs ${answer}`).toBe(vowel(answer));
      }
    }
  });

  it('never uses a heading as an ordre item', () => {
    const page = pageInput(0, 'Le réveil du volcan\n\nAu pied de la montagne, le village dormait encore. Léo ouvrit la fenêtre et regarda le sommet. Depuis trois jours, le volcan fumait sans bruit. Une lueur rouge apparut au sommet ce matin.');
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const ordre = generateLocalQuestions([page], 3, ['ordre'], seed).filter((q): q is Extract<Question, { type: 'ordre' }> => q.type === 'ordre');
      expect(ordre.length).toBeGreaterThan(0);
      for (const q of ordre) expect(q.itemsInOrder).not.toContain('Le réveil du volcan');
    }
  });

  it('builds ordre questions from 3 to 5 consecutive sentences of one page', () => {
    const questions = generateLocalQuestions(PAGES, 3, ['ordre'], 11).filter((q): q is Extract<Question, { type: 'ordre' }> => q.type === 'ordre');
    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) {
      expect(q.itemsInOrder.length).toBeGreaterThanOrEqual(3);
      expect(q.itemsInOrder.length).toBeLessThanOrEqual(5);
      const text = pageText(q.source.pageIndex);
      let cursor = text.indexOf(q.source.quote);
      expect(cursor).toBeGreaterThanOrEqual(0);
      for (const item of q.itemsInOrder) {
        const at = text.indexOf(item, cursor);
        expect(at, item).toBeGreaterThanOrEqual(cursor);
        cursor = at + item.length;
      }
      expect(q.source.quote.startsWith(q.itemsInOrder[0]!)).toBe(true);
      expect(q.source.quote.endsWith(q.itemsInOrder[q.itemsInOrder.length - 1]!)).toBe(true);
    }
  });

  it('only creates true vrai_faux statements copied from the text', () => {
    const questions = generateLocalQuestions(PAGES, 8, ['vrai_faux'], 5);
    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) {
      expect(q.type).toBe('vrai_faux');
      if (q.type !== 'vrai_faux') continue;
      expect(q.answer).toBe(true);
      expect(q.prompt).toContain(`« ${q.source.quote} »`);
      expect(q.source.quote).not.toMatch(/[?!«»—]/);
    }
  });

  it('mixes the requested types and ignores the unsupported ones', () => {
    const questions = generateLocalQuestions(PAGES, 6, ['reponse_libre', 'association', 'qcm', 'ordre'], 9);
    const types = new Set(questions.map((q) => q.type));
    expect(types).toEqual(new Set(['qcm', 'ordre']));
    expect(generateLocalQuestions(PAGES, 5, ['reponse_libre', 'association'])).toEqual([]);
  });

  it('never reuses a sentence in two questions', () => {
    const questions = generateLocalQuestions(PAGES, 12, ['qcm', 'ordre', 'vrai_faux'], 21);
    const used = new Set<string>();
    for (const q of questions) {
      const sentences = q.type === 'ordre' ? q.itemsInOrder : [q.source.quote];
      for (const s of sentences) {
        expect(used.has(s), s).toBe(false);
        used.add(s);
      }
    }
  });

  it('returns questions in reading order', () => {
    const questions = generateLocalQuestions(PAGES, 8, ['qcm', 'vrai_faux'], 2);
    const positions = questions.map((q) => q.source.pageIndex * 100_000 + pageText(q.source.pageIndex).indexOf(q.source.quote));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('returns fewer questions when the text is too short, and none for bad input', () => {
    const short = [pageInput(0, 'Le chat dort sur le tapis rouge du salon.')];
    expect(generateLocalQuestions(short, 5, ['qcm', 'ordre']).length).toBeLessThan(5);
    expect(generateLocalQuestions([], 5, ['qcm'])).toEqual([]);
    expect(generateLocalQuestions(PAGES, 0, ['qcm'])).toEqual([]);
    expect(generateLocalQuestions(PAGES, -3, ['qcm'])).toEqual([]);
    expect(generateLocalQuestions(PAGES, 100, ['qcm', 'ordre', 'vrai_faux']).length).toBeLessThanOrEqual(20);
  });
});
