import { describe, expect, it } from 'vitest';
import { countWords } from '../../src/ai/limits';
import { LIMITS } from '../../src/constants';
import { correctClosedAnswer } from '../../src/exercises/localCorrection';
import type { Question } from '../../src/types/exercises';

const source = { pageIndex: 0, quote: 'Le volcan crache de la lave.' };

const qcm: Question = {
  id: 'q1', type: 'qcm', prompt: 'Que crache le volcan ?', choices: ['de l’eau', 'de la lave', 'du sable'], correctIndex: 1,
  explanation: 'Le texte dit que le volcan crache de la lave.', source,
};
const vraiFaux: Question = { id: 'q2', type: 'vrai_faux', prompt: 'Le volcan crache de la lave.', answer: true, explanation: '', source };
const association: Question = {
  id: 'q3', type: 'association', prompt: 'Relie chaque animal à son milieu.', source,
  pairs: [{ left: 'poisson', right: 'mer' }, { left: 'écureuil', right: 'forêt' }, { left: 'chameau', right: 'désert' }, { left: 'ours blanc', right: 'banquise' }],
};
const ordre: Question = {
  id: 'q4', type: 'ordre', prompt: 'Remets dans l’ordre.', source,
  itemsInOrder: ['Il se réveille.', 'Il mange.', 'Il part à l’école.', 'Il rentre.'],
};
const libre: Question = { id: 'q5', type: 'reponse_libre', prompt: 'Pourquoi ?', expectedAnswer: 'Parce que.', keyPoints: [], source };

function expectKindFeedback(feedback: string): void {
  expect(feedback.length).toBeGreaterThan(10);
  expect(feedback.trim().toLowerCase()).not.toMatch(/^(faux|incorrect|non)[.!]?$/);
  expect(countWords(feedback)).toBeLessThanOrEqual(LIMITS.correctionFeedbackMaxWords);
}

describe('correctClosedAnswer', () => {
  it('returns null for free answers and mismatched types', () => {
    expect(correctClosedAnswer(libre, { type: 'reponse_libre', text: 'Parce que.' })).toBeNull();
    expect(correctClosedAnswer(qcm, { type: 'vrai_faux', value: true })).toBeNull();
    expect(correctClosedAnswer(ordre, { type: 'qcm', choiceIndex: 0 })).toBeNull();
  });

  it('corrects qcm answers', () => {
    const ok = correctClosedAnswer(qcm, { type: 'qcm', choiceIndex: 1 });
    expect(ok?.verdict).toBe('correct');
    expectKindFeedback(ok!.feedback);
    const ko = correctClosedAnswer(qcm, { type: 'qcm', choiceIndex: 0 });
    expect(ko?.verdict).toBe('incorrect');
    expectKindFeedback(ko!.feedback);
    expect(ko!.feedback).toContain('« de la lave »');
    expect(ko!.feedback).toContain('Le texte dit que le volcan crache de la lave.');
    expect(ko!.feedback).toMatch(/Relis/);
    expect(correctClosedAnswer(qcm, { type: 'qcm', choiceIndex: 9 })?.verdict).toBe('incorrect');
  });

  it('trims a long explanation to keep the feedback short', () => {
    const long = { ...qcm, explanation: Array.from({ length: 10 }, () => 'Cette phrase explique longuement pourquoi la réponse est la bonne réponse.').join(' ') } as Question;
    const result = correctClosedAnswer(long, { type: 'qcm', choiceIndex: 2 });
    expect(countWords(result!.feedback)).toBeLessThanOrEqual(LIMITS.correctionFeedbackMaxWords);
  });

  it('corrects vrai / faux answers with an explanation of the right value', () => {
    expect(correctClosedAnswer(vraiFaux, { type: 'vrai_faux', value: true })?.verdict).toBe('correct');
    const ko = correctClosedAnswer(vraiFaux, { type: 'vrai_faux', value: false });
    expect(ko?.verdict).toBe('incorrect');
    expect(ko!.feedback).toContain('c’est vrai');
    expectKindFeedback(ko!.feedback);
    const falseQuestion = { ...vraiFaux, answer: false } as Question;
    expect(correctClosedAnswer(falseQuestion, { type: 'vrai_faux', value: true })!.feedback).toContain('c’est faux');
  });

  it('corrects associations with a partial verdict from 50 %', () => {
    const all = association.type === 'association' ? association.pairs : [];
    expect(correctClosedAnswer(association, { type: 'association', pairs: [...all].reverse() })?.verdict).toBe('correct');
    const half = [all[0]!, all[1]!, { left: 'chameau', right: 'banquise' }, { left: 'ours blanc', right: 'désert' }];
    const partial = correctClosedAnswer(association, { type: 'association', pairs: half });
    expect(partial?.verdict).toBe('partiel');
    expect(partial!.feedback).toContain('2 bonnes paires sur 4');
    expectKindFeedback(partial!.feedback);
    const one = [all[0]!, { left: 'écureuil', right: 'mer' }];
    const ko = correctClosedAnswer(association, { type: 'association', pairs: one });
    expect(ko?.verdict).toBe('incorrect');
    expect(ko!.feedback).toContain('1 bonne paire sur 4');
    expectKindFeedback(ko!.feedback);
  });

  it('compares association texts loosely and ignores duplicates', () => {
    const all = association.type === 'association' ? association.pairs : [];
    const loose = all.map((p) => ({ left: p.left.toUpperCase(), right: ` ${p.right}. ` }));
    expect(correctClosedAnswer(association, { type: 'association', pairs: loose })?.verdict).toBe('correct');
    const duplicated = [{ left: 'poisson', right: 'désert' }, ...all];
    expect(correctClosedAnswer(association, { type: 'association', pairs: duplicated })?.verdict).toBe('partiel');
  });

  it('corrects the order with a partial verdict from 50 %', () => {
    const items = ordre.type === 'ordre' ? ordre.itemsInOrder : [];
    expect(correctClosedAnswer(ordre, { type: 'ordre', items: [...items] })?.verdict).toBe('correct');
    const oneMoved = [items[1]!, items[2]!, items[3]!, items[0]!];
    expect(correctClosedAnswer(ordre, { type: 'ordre', items: oneMoved })?.verdict).toBe('partiel');
    const reversed = [...items].reverse();
    const ko = correctClosedAnswer(ordre, { type: 'ordre', items: reversed });
    expect(ko?.verdict).toBe('incorrect');
    expectKindFeedback(ko!.feedback);
    expect(correctClosedAnswer(ordre, { type: 'ordre', items: items.slice(0, 3) })?.verdict).toBe('partiel');
    expect(correctClosedAnswer(ordre, { type: 'ordre', items: [] })?.verdict).toBe('incorrect');
  });

  it('gives the same praise for the same question', () => {
    const a = correctClosedAnswer(qcm, { type: 'qcm', choiceIndex: 1 });
    const b = correctClosedAnswer(qcm, { type: 'qcm', choiceIndex: 1 });
    expect(a).toEqual(b);
  });
});
