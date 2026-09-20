// What happens behind 📖 Définition, 💡 Explique, ✨ Simplifie and ❓ question: every answer comes from the AI (§25).
// The child never sees which engine answered (§59).
import {
  KID_MESSAGES,
  LIMITS,
  type AIPageInput,
  type AIResult,
  type Id,
  type SourceRef,
} from '@aide/shared';
import { kidMessageForUnavailable, requestAI } from '../../ai/aiClient';
import { help } from '../../i18n/fr/help';

export type HelpKind = 'definition' | 'explain' | 'simplify' | 'question';

/** Context of a selection in the reader. */
export interface HelpTextContext {
  childId: Id;
  documentId: Id;
  documentHash: string | null;
  pageIndex: number;
  /** Selected text (a word or a longer passage). */
  text: string;
  isSingleWord: boolean;
  /** Sentence containing the selection. */
  sentence: string;
  /** Block (paragraph) text. */
  paragraph: string;
  ocrLowConfidence: boolean;
}

export type MessageTone = 'info' | 'warning' | 'adult';

export type HelpOutcome =
  | { kind: 'definition'; headword: string; definition: string; example: string | null; partOfSpeech: string | null; attribution: string | null; kidFriendly: boolean }
  | { kind: 'definition_not_found' }
  | { kind: 'explanation'; text: string; example: string | null; quotes: string[]; sourceWarning: boolean }
  | { kind: 'simplified'; text: string; sourceWarning: boolean }
  | { kind: 'answer'; text: string; refs: SourceRef[]; sourceWarning: boolean }
  | { kind: 'message'; text: string; tone: MessageTone; canRetry: boolean };

export interface HelpDeps {
  requestAI: typeof requestAI;
}

const defaultDeps: HelpDeps = { requestAI };

/** Maps a non-ok AI result to a kind message for the child. */
export function messageFor(result: Exclude<AIResult<unknown>, { status: 'ok' }>): Extract<HelpOutcome, { kind: 'message' }> {
  switch (result.status) {
    case 'not_in_text':
      return { kind: 'message', text: result.message || KID_MESSAGES.notInText, tone: 'info', canRetry: false };
    case 'blocked':
      if (result.reason === 'adult_redirect') return { kind: 'message', text: result.message || KID_MESSAGES.adultRedirect, tone: 'adult', canRetry: false };
      return { kind: 'message', text: result.message || KID_MESSAGES.blocked, tone: 'info', canRetry: false };
    case 'unavailable': {
      const canRetry = ['offline', 'timeout', 'busy', 'provider_error'].includes(result.reason);
      return { kind: 'message', text: result.message || kidMessageForUnavailable(result.reason), tone: 'warning', canRetry };
    }
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * 📖 Définition: the AI defines the word in its sentence (explain_word; the definitions written by the adult in the
 * « Glossaire » come first, on the server). Decision 2026-09-19: no built-in glossary nor dictionary any more.
 */
export async function runDefinition(ctx: HelpTextContext, opts: { signal?: AbortSignal } = {}, deps: HelpDeps = defaultDeps): Promise<HelpOutcome> {
  const result = await deps.requestAI('explain_word', {
    childId: ctx.childId, documentId: ctx.documentId, documentHash: ctx.documentHash, pageIndex: ctx.pageIndex, ocrLowConfidence: ctx.ocrLowConfidence,
    word: clip(ctx.text, LIMITS.wordMaxChars),
    sentence: clip(ctx.sentence, LIMITS.selectionMaxChars),
    paragraph: clip(ctx.paragraph, LIMITS.paragraphMaxChars),
  }, { signal: opts.signal });
  if (result.status !== 'ok') return messageFor(result);
  return {
    kind: 'definition', headword: ctx.text.trim(), definition: result.data.explanation, example: result.data.example, partOfSpeech: null,
    attribution: null, kidFriendly: true,
  };
}

/** 💡 Explique: the AI explains the selection (a single word: its meaning in the sentence and the paragraph). */
export async function runExplain(ctx: HelpTextContext, opts: { signal?: AbortSignal } = {}, deps: HelpDeps = defaultDeps): Promise<HelpOutcome> {
  const result = await deps.requestAI('explain_text', {
    childId: ctx.childId, documentId: ctx.documentId, documentHash: ctx.documentHash, pageIndex: ctx.pageIndex, ocrLowConfidence: ctx.ocrLowConfidence,
    text: clip(ctx.text, LIMITS.selectionMaxChars),
    paragraph: clip(ctx.paragraph, LIMITS.paragraphMaxChars),
  }, { signal: opts.signal });
  if (result.status !== 'ok') return messageFor(result);
  return {
    kind: 'explanation', text: result.data.explanation, example: result.data.example, quotes: result.data.sourceQuotes,
    sourceWarning: result.meta.sourceWarning || ctx.ocrLowConfidence,
  };
}

export async function runSimplify(ctx: HelpTextContext, opts: { signal?: AbortSignal } = {}, deps: HelpDeps = defaultDeps): Promise<HelpOutcome> {
  // A single word is simplified within its sentence.
  const text = ctx.isSingleWord ? ctx.sentence : ctx.text;
  const result = await deps.requestAI('simplify_text', {
    childId: ctx.childId, documentId: ctx.documentId, documentHash: ctx.documentHash, pageIndex: ctx.pageIndex,
    ocrLowConfidence: ctx.ocrLowConfidence, text: clip(text, LIMITS.selectionMaxChars),
  }, { signal: opts.signal });
  if (result.status !== 'ok') return messageFor(result);
  return { kind: 'simplified', text: result.data.simplifiedText, sourceWarning: result.meta.sourceWarning || ctx.ocrLowConfidence };
}

export interface QuestionContext { childId: Id; documentId: Id; documentHash: string | null; pages: AIPageInput[] }

export async function runQuestion(ctx: QuestionContext, question: string, opts: { signal?: AbortSignal } = {}, deps: HelpDeps = defaultDeps): Promise<HelpOutcome> {
  const clean = question.trim().slice(0, LIMITS.questionOnTextMaxChars);
  if (clean === '') return { kind: 'message', text: help.question.empty, tone: 'info', canRetry: false };
  if (ctx.pages.length === 0) return { kind: 'message', text: help.question.noText, tone: 'info', canRetry: false };
  const result = await deps.requestAI('question_on_text', {
    childId: ctx.childId, documentId: ctx.documentId, documentHash: ctx.documentHash, question: clean, pages: ctx.pages,
  }, { signal: opts.signal });
  if (result.status !== 'ok') return messageFor(result);
  const sourceWarning = result.meta.sourceWarning || ctx.pages.some((p) => p.ocrLowConfidence);
  return { kind: 'answer', text: result.data.answer, refs: result.data.sourceRefs, sourceWarning };
}

/** Whether a finished outcome went through the AI layer (session statistics). */
export function countsAsAiRequest(kind: HelpKind, outcome: HelpOutcome): boolean {
  return !(outcome.kind === 'message' && (outcome.text === help.question.empty || outcome.text === help.question.noText));
}
