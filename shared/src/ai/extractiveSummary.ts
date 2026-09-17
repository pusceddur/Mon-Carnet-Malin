import { LIMITS } from '../constants';
import type { AIPageInput, SummaryData, SummaryLevel } from '../types/ai';
import { scoreSentences, type ScoredSentence } from './sentenceScore';

const MIN_SENTENCE_WORDS = 4;
const MAX_SENTENCE_WORDS = 45;

/** Narrative sentences only: no titles (no final punctuation), no questions, no dialogue lines. */
function isSummarizable(s: ScoredSentence): boolean {
  const text = s.sentence.text;
  return s.words >= MIN_SENTENCE_WORDS && s.words <= MAX_SENTENCE_WORDS && /[.!…»"\u201D)]$/.test(text)
    && !text.includes('?') && !/^[-\u2013\u2014]/.test(text);
}

/**
 * Deterministic extractive summary: the best-scored original sentences (bref 3 / normal 6 / detaille 10, within the
 * word limit of the level) shown in reading order. sourceRefs = the chosen sentences; keyPoints = the short ones.
 */
export function extractiveSummary(pages: AIPageInput[], level: SummaryLevel): SummaryData {
  const scored = scoreSentences(pages);
  const wanted = LIMITS.localSummarySentences[level];
  const maxWords = LIMITS.summaryMaxWords[level];
  let candidates = scored.filter(isSummarizable);
  if (candidates.length === 0) candidates = scored.filter((s) => s.words > 0);
  const ranked = [...candidates].sort((a, b) => b.score - a.score || a.sentence.order - b.sentence.order);

  const chosen: ScoredSentence[] = [];
  let total = 0;
  for (const s of ranked) {
    if (chosen.length >= wanted) break;
    if (total + s.words > maxWords) continue;
    chosen.push(s);
    total += s.words;
  }
  if (chosen.length === 0 && ranked.length > 0) {
    const shortest = [...ranked.slice(0, 5)].sort((a, b) => a.words - b.words || a.sentence.order - b.sentence.order)[0];
    if (shortest) chosen.push(shortest);
  }
  chosen.sort((a, b) => a.sentence.order - b.sentence.order);

  return {
    summary: chosen.map((s) => s.sentence.text.replace(/\s+/g, ' ')).join(' '),
    keyPoints: chosen
      .filter((s) => s.words <= LIMITS.keyPointMaxWords)
      .slice(0, LIMITS.keyPointsMax)
      .map((s) => s.sentence.text.replace(/\s+/g, ' ')),
    sourceRefs: chosen.map((s) => ({ pageIndex: s.sentence.pageIndex, quote: s.sentence.text })),
  };
}
