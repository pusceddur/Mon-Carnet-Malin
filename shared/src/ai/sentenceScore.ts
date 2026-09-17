import { normalizeForMatch } from '../text/normalize';
import { locateSentences, type LocatedSentence } from '../text/passages';
import { isStopword, lightStem } from '../text/stopwords';
import { tokenizeWords } from '../text/tokenize';
import type { AIPageInput } from '../types/ai';
import { countWords } from './limits';

export interface ScoredSentence { sentence: LocatedSentence; words: number; score: number }

/** Content-word stems of a text (no stopwords, no short words, no numbers). */
export function contentStems(text: string): string[] {
  const out: string[] = [];
  for (const t of tokenizeWords(text)) {
    const n = normalizeForMatch(t.word);
    if (n.length < 3 || /\d/.test(n) || isStopword(n)) continue;
    for (const part of n.split(' ')) if (part.length >= 3 && !isStopword(part)) out.push(lightStem(part));
  }
  return out;
}

/**
 * Sentences scored by the document frequency of their content words:
 * score = (Σ (frequency − 1) + 0.5 per distinct stem) / √(content words + 1), with a small bonus for the first sentence.
 */
export function scoreSentences(pages: readonly AIPageInput[]): ScoredSentence[] {
  const sentences = locateSentences(pages);
  const stemsBySentence = sentences.map((s) => contentStems(s.text));
  const frequency = new Map<string, number>();
  for (const stems of stemsBySentence) for (const stem of stems) frequency.set(stem, (frequency.get(stem) ?? 0) + 1);
  return sentences.map((sentence, i) => {
    const stems = stemsBySentence[i] ?? [];
    const distinct = new Set(stems);
    let sum = 0;
    for (const stem of distinct) sum += (frequency.get(stem) ?? 1) - 1;
    const base = distinct.size === 0 ? 0 : (sum + distinct.size * 0.5) / Math.sqrt(stems.length + 1);
    return { sentence, words: countWords(sentence.text), score: i === 0 ? base * 1.1 : base };
  });
}

