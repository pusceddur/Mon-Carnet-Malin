import { AGE_THRESHOLDS, normalizeForMatch, readabilityFr, tokenizeWords, type ExplanationDifficulty, type ReadabilityReport } from '@aide/shared';
import type { GuardIssue } from '../ai/validation/types';

/** §15.5: ratios only with at least this many words (below: max sentence length only). */
export const AGE_MIN_WORDS_FOR_RATIOS = 30;
/** Second attempt: accepted with readability_warning unless the average exceeds the threshold by more than 30 %. */
export const AGE_SECOND_ATTEMPT_REJECT_RATIO = 1.3;

export interface AgeCheckInput {
  texts: readonly string[];
  difficulty: ExplanationDifficulty;
  /** Words of the source, question, child's answer and glossary (exempt from the long-word count). */
  exemptWords: Iterable<string>;
  attempt: 1 | 2;
}

export interface AgeCheckResult {
  ok: boolean;
  issues: GuardIssue[];
  readabilityWarning: boolean;
  report: ReadabilityReport | null;
}

function asSentences(texts: readonly string[]): string {
  return texts
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map((t) => (/[.!?…»")]$/.test(t) ? t : `${t}.`))
    .join(' ');
}

/** Normalized words usable as readabilityFr exemptions. */
export function exemptWordsOf(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    for (const token of tokenizeWords(text)) {
      out.add(token.word);
      out.add(token.word.toLowerCase());
      out.add(normalizeForMatch(token.word));
    }
  }
  return out;
}

export function checkAge(input: AgeCheckInput): AgeCheckResult {
  const text = asSentences(input.texts);
  if (text === '') return { ok: true, issues: [], readabilityWarning: false, report: null };
  const report = readabilityFr(text, input.exemptWords);
  const t = AGE_THRESHOLDS[input.difficulty];
  const issues: GuardIssue[] = [];
  const withRatios = report.words >= AGE_MIN_WORDS_FOR_RATIOS;

  if (report.maxWordsPerSentence > t.maxWordsPerSentence) {
    issues.push({
      code: 'age_sentence_too_long', detail: `max:${report.maxWordsPerSentence}>${t.maxWordsPerSentence}`,
      feedback: `Une phrase a ${report.maxWordsPerSentence} mots : coupe-la. Maximum ${t.maxWordsPerSentence} mots par phrase.`,
    });
  }
  if (withRatios && report.avgWordsPerSentence > t.avgWordsPerSentence) {
    issues.push({
      code: 'age_avg_sentence', detail: `avg:${report.avgWordsPerSentence.toFixed(1)}>${t.avgWordsPerSentence}`,
      feedback: `Tes phrases sont trop longues : vise en moyenne ${t.avgWordsPerSentence} mots par phrase au maximum.`,
    });
  }
  if (withRatios && report.longWordRatio > t.longWordRatio) {
    issues.push({
      code: 'age_long_words', detail: `long:${report.longWordRatio.toFixed(2)}>${t.longWordRatio}`,
      feedback: 'Utilise des mots plus courts et plus simples (garde les mots du texte si besoin).',
    });
  }

  if (issues.length === 0) return { ok: true, issues, readabilityWarning: false, report };
  if (input.attempt === 1) return { ok: false, issues, readabilityWarning: false, report };

  const reference = withRatios
    ? report.avgWordsPerSentence / t.avgWordsPerSentence
    : report.maxWordsPerSentence / t.maxWordsPerSentence;
  if (reference > AGE_SECOND_ATTEMPT_REJECT_RATIO) return { ok: false, issues, readabilityWarning: false, report };
  return { ok: true, issues: [], readabilityWarning: true, report };
}
