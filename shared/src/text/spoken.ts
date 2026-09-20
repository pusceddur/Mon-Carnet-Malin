// §22 « Préparer la lecture »: a block can carry a version prepared for the voice (`TextBlock.spoken`). It has exactly the
// words of the displayed text, in the same order; only punctuation, spaces and capitals may differ.
import { tokenizeWords, type WordToken } from './tokenize';

/** Longest prepared text of one block (the displayed text plus room for punctuation). */
export const SPOKEN_BLOCK_MAX_CHARS = 8000;

function wordKey(word: string): string {
  return word.normalize('NFC').toLowerCase().replace(/[’ʼ‘`´]/g, "'");
}

export interface SpokenAlignment {
  /** Words of the displayed text. */
  shown: WordToken[];
  /** Same words in the prepared text (same count, same order). */
  said: WordToken[];
}

/** Word by word pairing of the displayed and the prepared text; null when the words differ (the preparation is not usable). */
export function alignSpokenText(display: string, prepared: string): SpokenAlignment | null {
  if (prepared.length > SPOKEN_BLOCK_MAX_CHARS) return null;
  const shown = tokenizeWords(display);
  const said = tokenizeWords(prepared);
  if (shown.length === 0 || shown.length !== said.length) return null;
  for (let i = 0; i < shown.length; i++) {
    if (wordKey(shown[i]!.word) !== wordKey(said[i]!.word)) return null;
  }
  return { shown, said };
}

/** The prepared text keeps the words of the displayed one. */
export function isSpokenTextValid(display: string, prepared: string): boolean {
  return alignSpokenText(display, prepared) !== null;
}
