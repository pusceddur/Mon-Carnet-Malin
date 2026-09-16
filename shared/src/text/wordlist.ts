// STUB: shared-core
import { normalizeForMatch } from './normalize';

export interface WordList { has(normalizedWord: string): boolean; size: number }

/** Normalizes with normalizeForMatch. */
export function createWordList(words: Iterable<string>): WordList {
  const set = new Set<string>();
  for (const w of words) set.add(normalizeForMatch(w));
  return { has: (w) => set.has(w), size: set.size };
}
