import { LIMITS } from '../constants';
import { countWords } from '../ai/limits';
import { normalizeForMatch } from '../text/normalize';
import { segmentSentences } from '../text/segment';
import type { AnswerResponse, Question, Verdict } from '../types/exercises';
import { EXERCISE_TEXTS_FR as T, formatText } from './messages.fr';

const PARTIAL_RATIO = 0.5;

function pick<V>(variants: readonly V[], key: string): V {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return variants[h % variants.length]!;
}

/** Joins feedback parts, dropping explanation sentences that would exceed the word limit. */
function compose(parts: readonly string[], explanation: string, tail: string): string {
  const head = parts.filter((p) => p.length > 0).join(' ');
  let budget = LIMITS.correctionFeedbackMaxWords - countWords(head) - countWords(tail);
  const kept: string[] = [];
  const text = explanation.trim();
  for (const s of segmentSentences(text)) {
    const sentence = text.slice(s.start, s.end);
    const words = countWords(sentence);
    if (words > budget) break;
    kept.push(sentence);
    budget -= words;
  }
  return [head, ...kept, tail].filter((p) => p.length > 0).join(' ');
}

/** Longest common subsequence length. */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = 0;
    for (let j = 1; j <= b.length; j++) {
      const saved = row[j]!;
      row[j] = a[i - 1] === b[j - 1] ? prevDiag + 1 : Math.max(row[j]!, row[j - 1]!);
      prevDiag = saved;
    }
  }
  return row[b.length]!;
}

function verdictFor(ratio: number): Verdict {
  if (ratio >= 1) return 'correct';
  return ratio >= PARTIAL_RATIO ? 'partiel' : 'incorrect';
}

/**
 * Deterministic correction of closed questions (C11), with kind French feedback that never says only « faux ».
 * association / ordre: 'partiel' from 50 % correct. Returns null for reponse_libre and mismatched types.
 */
export function correctClosedAnswer(q: Question, r: AnswerResponse): { verdict: Verdict; feedback: string } | null {
  const praise = pick(T.correct, q.id);
  switch (q.type) {
    case 'reponse_libre':
      return null;
    case 'qcm': {
      if (r.type !== 'qcm') return null;
      if (r.choiceIndex === q.correctIndex) return { verdict: 'correct', feedback: praise };
      const answer = q.choices[q.correctIndex] ?? '';
      const intro = answer ? formatText(T.qcmIncorrect, { answer }) : '';
      return { verdict: 'incorrect', feedback: compose([intro], q.explanation, T.rereadToUnderstand) };
    }
    case 'vrai_faux': {
      if (r.type !== 'vrai_faux') return null;
      if (r.value === q.answer) return { verdict: 'correct', feedback: praise };
      const intro = q.answer ? T.vraiFauxShouldBeTrue : T.vraiFauxShouldBeFalse;
      return { verdict: 'incorrect', feedback: compose([intro], q.explanation, T.rereadToUnderstand) };
    }
    case 'association': {
      if (r.type !== 'association') return null;
      const given = new Map<string, string>();
      for (const p of r.pairs) {
        const left = normalizeForMatch(p.left);
        if (!given.has(left)) given.set(left, normalizeForMatch(p.right));
      }
      const total = q.pairs.length;
      const found = q.pairs.filter((p) => given.get(normalizeForMatch(p.left)) === normalizeForMatch(p.right)).length;
      const verdict = total === 0 ? 'correct' : verdictFor(found / total);
      if (verdict === 'correct') return { verdict, feedback: praise };
      if (verdict === 'partiel') return { verdict, feedback: `${formatText(T.associationPartial, { found, total })} ${T.rereadAndRetry}` };
      const template = found > 1 ? T.associationIncorrectPlural : T.associationIncorrect;
      return { verdict, feedback: `${formatText(template, { found, total })} ${T.rereadAndRetry}` };
    }
    case 'ordre': {
      if (r.type !== 'ordre') return null;
      const expected = q.itemsInOrder.map(normalizeForMatch);
      const given = r.items.map(normalizeForMatch);
      const exact = expected.length === given.length && expected.every((e, i) => e === given[i]);
      if (exact) return { verdict: 'correct', feedback: praise };
      const ratio = expected.length === 0 ? 0 : lcsLength(expected, given) / expected.length;
      const verdict = verdictFor(Math.min(ratio, 0.99));
      const intro = verdict === 'partiel' ? T.ordrePartial : T.ordreIncorrect;
      return { verdict, feedback: `${intro} ${T.rereadAndRetry}` };
    }
  }
}
