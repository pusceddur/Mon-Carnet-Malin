// OCR quality score 0..100 from engine confidence, share of low-confidence words, share of words found in the French
// word list and amount of noise characters.
import { normalizeForMatch, tokenizeWords, type TextBlock, type WordList } from '@aide/shared';
import type { OcrLine } from './ocrLines';

export const LOW_WORD_CONFIDENCE = 60;

export interface QualityReport {
  /** 0..100, rounded. */
  score: number;
  wordCount: number;
  /** Mean word confidence 0..100 (length-weighted), or the engine page confidence. Null when unknown. */
  meanConfidence: number | null;
  /** Share of words under LOW_WORD_CONFIDENCE. Null without word-level confidences. */
  lowConfidenceRatio: number | null;
  /** Share of alphabetic tokens found in the word list. Null without a word list. */
  dictionaryRatio: number | null;
  /** Share of non-space characters that are neither letters, digits nor usual punctuation. */
  noiseRatio: number;
}

export interface QualityInput {
  text: string;
  /** Word-level confidences when the engine provides them. */
  words?: readonly { text: string; confidence: number }[];
  /** Page-level confidence 0..100 (engine or server). */
  pageConfidence?: number | null;
}

const USUAL_PUNCTUATION = new Set(Array.from(".,;:!?'’‘\"«»“”()[]-‐‑–—…%/°€$&+=*#@§²³ºª·"));
const ELISIONS = new Set(['l', 'd', 'j', 'm', 'n', 's', 't', 'c', 'qu', 'jusqu', 'lorsqu', 'puisqu', 'quoiqu', 'presqu']);
const APOSTROPHE = /['’ʼ]$/;

function isNoiseChar(ch: string): boolean {
  if (/\s/.test(ch)) return false;
  if (/[\p{L}\p{N}]/u.test(ch)) return false;
  return !USUAL_PUNCTUATION.has(ch);
}

/** A token is « known » when it is a number, an elided article/pronoun, or its normalized form is in the list. */
export function isKnownToken(token: string, list: WordList): boolean {
  if (/^[\p{N}.,]+$/u.test(token)) return true;
  if (APOSTROPHE.test(token)) return ELISIONS.has(normalizeForMatch(token));
  const normalized = normalizeForMatch(token);
  if (normalized.length === 0) return true;
  if (list.has(normalized)) return true;
  // Compound words (« arc-en-ciel ») are listed whole; otherwise accept when every part is a word.
  const parts = normalized.split(' ');
  return parts.length > 1 && parts.every((p) => list.has(p));
}

export function scoreOcrQuality(input: QualityInput, list: WordList | null): QualityReport {
  const tokens = tokenizeWords(input.text).map((t) => t.word);
  const wordCount = tokens.length;

  let nonSpace = 0;
  let noise = 0;
  for (const ch of input.text) {
    if (/\s/.test(ch)) continue;
    nonSpace++;
    if (isNoiseChar(ch)) noise++;
  }
  const noiseRatio = nonSpace === 0 ? 0 : noise / nonSpace;

  let meanConfidence: number | null = null;
  let lowConfidenceRatio: number | null = null;
  const words = (input.words ?? []).filter((w) => w.text.trim().length > 0);
  if (words.length > 0) {
    let weighted = 0;
    let weight = 0;
    let low = 0;
    for (const w of words) {
      const len = Math.max(1, w.text.length);
      weighted += w.confidence * len;
      weight += len;
      if (w.confidence < LOW_WORD_CONFIDENCE) low++;
    }
    meanConfidence = weighted / weight;
    lowConfidenceRatio = low / words.length;
  } else if (input.pageConfidence !== null && input.pageConfidence !== undefined && Number.isFinite(input.pageConfidence)) {
    meanConfidence = Math.min(100, Math.max(0, input.pageConfidence));
  }

  let dictionaryRatio: number | null = null;
  if (list && list.size > 0) {
    const alphabetic = tokens.filter((t) => /\p{L}/u.test(t));
    if (alphabetic.length > 0) dictionaryRatio = alphabetic.filter((t) => isKnownToken(t, list)).length / alphabetic.length;
  }

  if (wordCount === 0) {
    return { score: 0, wordCount, meanConfidence, lowConfidenceRatio, dictionaryRatio, noiseRatio };
  }

  const parts: { weight: number; value: number }[] = [];
  if (meanConfidence !== null) parts.push({ weight: 0.35, value: meanConfidence / 100 });
  if (lowConfidenceRatio !== null) parts.push({ weight: 0.15, value: 1 - lowConfidenceRatio });
  if (dictionaryRatio !== null) parts.push({ weight: 0.35, value: dictionaryRatio });
  parts.push({ weight: 0.15, value: 1 - Math.min(1, noiseRatio * 4) });
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  let score = (100 * parts.reduce((s, p) => s + p.weight * p.value, 0)) / totalWeight;
  // Very little text: the statistics are fragile, stay cautious.
  if (wordCount < 3) score *= 0.85;
  return { score: Math.round(Math.min(100, Math.max(0, score))), wordCount, meanConfidence, lowConfidenceRatio, dictionaryRatio, noiseRatio };
}

export function qualityFromOcrLines(lines: readonly OcrLine[], pageConfidence: number | null, list: WordList | null): QualityReport {
  return scoreOcrQuality(
    { text: lines.map((l) => l.text).join('\n'), words: lines.flatMap((l) => l.words), pageConfidence },
    list,
  );
}

export function qualityFromBlocks(blocks: readonly TextBlock[], pageConfidence: number | null, list: WordList | null): QualityReport {
  return scoreOcrQuality({ text: blocks.map((b) => b.text).join('\n\n'), pageConfidence }, list);
}
