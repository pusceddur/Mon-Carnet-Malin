import { normalizeForMatch } from './normalize';

export interface WordList { has(normalizedWord: string): boolean; size: number }

/** Set of words stored in normalizeForMatch form; `has` expects an already normalized word. */
export function createWordList(words: Iterable<string>): WordList {
  const set = new Set<string>();
  for (const w of words) {
    const n = normalizeForMatch(w);
    if (n.length > 0) set.add(n);
  }
  return { has: (w) => set.has(w), size: set.size };
}
