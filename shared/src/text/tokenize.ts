// STUB: shared-core
export interface WordToken { start: number; end: number; word: string }

// Unicode letters + digits; inner hyphen kept ("arc-en-ciel" = 1 token); apostrophe splits ("l’arbre" -> "l’", "arbre")
export function tokenizeWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    tokens.push({ start, end: start + m[0].length, word: m[0] });
  }
  return tokens;
}
