// Helpers around LIMITS (word counting for LengthGuard etc.). The numeric limits live in ../constants.ts.
import { isElisionToken, tokenizeWords } from '../text/tokenize';

/** Words of a text as a reader counts them: « l’arbre » and « arc-en-ciel » are one word each. */
export function countWords(text: string): number {
  let n = 0;
  for (const t of tokenizeWords(text)) if (!isElisionToken(t.word)) n++;
  return n;
}
