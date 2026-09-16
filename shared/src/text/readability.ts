// STUB: shared-core
import { tokenizeWords } from './tokenize';

export function countSyllablesFr(word: string): number {
  const groups = word.toLowerCase().match(/[aeiouyàâäéèêëîïôöùûüÿœæ]+/g);
  return Math.max(1, groups?.length ?? 0);
}

export interface ReadabilityReport { words: number; sentences: number; avgWordsPerSentence: number; maxWordsPerSentence: number; longWordRatio: number /* >= 4 syllables */; kandelMoles: number }

export function readabilityFr(text: string, exemptWords?: Iterable<string>): ReadabilityReport {
  void exemptWords;
  const words = tokenizeWords(text).length;
  const sentences = words > 0 ? 1 : 0;
  return {
    words,
    sentences,
    avgWordsPerSentence: words,
    maxWordsPerSentence: words,
    longWordRatio: 0,
    kandelMoles: 0,
  };
}
