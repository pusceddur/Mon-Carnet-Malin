// STUB: shared-core
// Helpers around LIMITS (word counting for LengthGuard etc.). The numeric limits live in ../constants.ts.
import { tokenizeWords } from '../text/tokenize';

export function countWords(text: string): number {
  return tokenizeWords(text).length;
}
