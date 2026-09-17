import { countWords, LIMITS, type ExplanationDifficulty, type SummaryLevel } from '@aide/shared';
import { guardResult, type GuardIssue, type GuardResult } from '../ai/validation/types';

export interface LengthRule {
  field: string;
  text: string;
  maxWords: number;
}

export function checkLengthRules(rules: readonly LengthRule[]): GuardResult {
  const issues: GuardIssue[] = [];
  for (const rule of rules) {
    const words = countWords(rule.text);
    if (words > rule.maxWords) {
      issues.push({
        code: 'length_exceeded',
        detail: `${rule.field}:${words}>${rule.maxWords}`,
        feedback: `Le champ « ${rule.field} » est trop long (${words} mots) : maximum ${rule.maxWords} mots.`,
      });
    }
  }
  return guardResult(issues);
}

export function explainWordMaxWords(difficulty: ExplanationDifficulty): number {
  return difficulty === 'tres_simple' ? LIMITS.explainWordTresSimpleMaxWords : LIMITS.explainWordMaxWords;
}

export function summaryMaxWords(level: SummaryLevel): number {
  return LIMITS.summaryMaxWords[level];
}

/** §15.5: simplified text words within [0.3 × source, max(1.5 × source, source + 12)]. */
export function checkSimplifyLength(sourceText: string, simplifiedText: string): GuardResult {
  const sourceWords = countWords(sourceText);
  const words = countWords(simplifiedText);
  const min = Math.floor(LIMITS.simplifyMinRatio * sourceWords);
  const max = Math.max(Math.ceil(LIMITS.simplifyMaxRatio * sourceWords), sourceWords + LIMITS.simplifyMaxExtraWords);
  if (words < min) {
    return guardResult([{
      code: 'length_too_short', detail: `simplifiedText:${words}<${min}`,
      feedback: `Le texte simplifié est trop court (${words} mots) : garde toutes les informations importantes (au moins ${min} mots).`,
    }]);
  }
  if (words > max) {
    return guardResult([{
      code: 'length_exceeded', detail: `simplifiedText:${words}>${max}`,
      feedback: `Le texte simplifié est trop long (${words} mots) : maximum ${max} mots.`,
    }]);
  }
  return guardResult([]);
}

/** Recognized handwriting: at most LIMITS.answerMaxChars characters. */
export function checkCharLimit(field: string, text: string, maxChars: number): GuardResult {
  if (text.length <= maxChars) return guardResult([]);
  return guardResult([{ code: 'length_exceeded', detail: `${field}:${text.length}>${maxChars}chars` }]);
}
