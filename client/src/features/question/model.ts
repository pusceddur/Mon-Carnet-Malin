// « Pose ta question » (§18.4): pure helpers of the question page (gating, request building, result mapping).
import {
  DEFAULT_PARENT_SETTINGS,
  KID_MESSAGES,
  LIMITS,
  type AIResult,
  type AIUnavailableReason,
  type FreeQuestionData,
  type FreeQuestionRequest,
  type Id,
  type ParentSettings,
} from '@aide/shared';

export type QuestionMode = FreeQuestionRequest['mode'];
export interface PreviousExchange { question: string; answer: string }

/** One ask: the question, the exchange it follows (« Je n'ai pas compris », suggestion) and the mode. */
export interface QuestionAsk { question: string; previous: PreviousExchange | null; mode: QuestionMode }

export type QuestionOutcome =
  | { kind: 'answer'; answer: string; example: string | null; suggestions: string[] }
  | { kind: 'blocked'; message: string }
  | { kind: 'adult_redirect'; message: string }
  | { kind: 'unavailable'; message: string; offline: boolean; canRetry: boolean };

/**
 * Whether the child sees « Pose ta question »: AI on and the parent flag on. Settings cached before §18 have no
 * `freeQuestion` value: the default (on) applies, as on the server.
 */
export function freeQuestionEnabled(settings: ParentSettings | null | undefined): boolean {
  const ai = (settings ?? DEFAULT_PARENT_SETTINGS).ai;
  return ai.enabled && ai.features?.freeQuestion !== false;
}

/** Question as sent: whitespace (dictation line breaks included) collapsed. */
export function cleanQuestion(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isAskable(text: string): boolean {
  const clean = cleanQuestion(text);
  return clean.length > 0 && clean.length <= LIMITS.freeQuestionMaxChars;
}

export function buildFreeQuestionRequest(childId: Id, ask: QuestionAsk): FreeQuestionRequest {
  const previous = ask.previous
    ? {
      question: cleanQuestion(ask.previous.question).slice(0, LIMITS.freeQuestionMaxChars),
      answer: ask.previous.answer.slice(0, LIMITS.answerMaxChars),
    }
    : null;
  return {
    childId,
    documentId: null,
    documentHash: null,
    question: cleanQuestion(ask.question).slice(0, LIMITS.freeQuestionMaxChars),
    previous: previous && previous.question !== '' ? previous : null,
    mode: ask.mode,
  };
}

/** Follow-up questions the child can tap: non-empty, askable, distinct, at most 3. */
export function usableSuggestions(suggestions: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of suggestions) {
    const clean = cleanQuestion(raw);
    if (!isAskable(clean) || out.includes(clean)) continue;
    out.push(clean);
    if (out.length === 3) break;
  }
  return out;
}

/** Retrying cannot help when the parent settings, the quota, the budget or the size stop the request. */
const FINAL_REASONS: ReadonlySet<AIUnavailableReason> = new Set<AIUnavailableReason>([
  'ai_disabled', 'feature_disabled', 'quota', 'budget', 'payload_too_large',
]);

/** Child-facing outcome of a free question result. Messages come from the result (server or aiClient), else the standard ones. */
export function toQuestionOutcome(result: AIResult<FreeQuestionData>): QuestionOutcome {
  switch (result.status) {
    case 'ok': {
      const answer = result.data.answer.trim();
      if (answer === '') return { kind: 'unavailable', message: KID_MESSAGES.unavailable, offline: false, canRetry: true };
      const example = result.data.example?.trim() ?? '';
      return { kind: 'answer', answer, example: example === '' ? null : example, suggestions: usableSuggestions(result.data.suggestions) };
    }
    case 'blocked': {
      const message = result.message.trim();
      if (result.reason === 'adult_redirect') return { kind: 'adult_redirect', message: message || KID_MESSAGES.questionAdultRedirect };
      return { kind: 'blocked', message: message || KID_MESSAGES.questionBlocked };
    }
    case 'unavailable':
      return {
        kind: 'unavailable',
        message: result.message.trim() || KID_MESSAGES.unavailable,
        offline: result.reason === 'offline',
        canRetry: !FINAL_REASONS.has(result.reason),
      };
    case 'not_in_text':
      // Not expected for a free question: treated as « no answer right now ».
      return { kind: 'unavailable', message: KID_MESSAGES.unavailable, offline: false, canRetry: true };
  }
}

/** Text read by « 🔊 Écouter »: the answer, then the example. */
export function spokenAnswer(outcome: Extract<QuestionOutcome, { kind: 'answer' }>): string {
  return [outcome.answer, outcome.example].filter((part): part is string => Boolean(part)).join('\n');
}

/** Paragraphs of the answer (blank lines or line breaks from the server). */
export function answerParagraphs(answer: string): string[] {
  return answer.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
}
