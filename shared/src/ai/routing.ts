// AI routing and deadlines (§8.2 step 5, §15.4).
import { LIMITS } from '../constants';
import type { AIOperation, AIRoute } from '../types/ai';
import type { ParentSettings } from '../types/settings';

/** Single end-to-end deadlines per route, regeneration included (§15.4). Client timeout = deadline + TIMINGS.aiClientTimeoutMarginMs. */
export const AI_DEADLINES: { readonly light: 40_000; readonly complex: 170_000 } = { light: 40_000, complex: 170_000 };

/** AI globally enabled and the parent flag of this operation on. */
export function isAIOperationEnabled(op: AIOperation, settings: Pick<ParentSettings, 'ai'>): boolean {
  const { ai } = settings;
  if (!ai.enabled) return false;
  switch (op) {
    case 'explain_word': return ai.features.explainWord;
    case 'explain_text': return ai.features.explainText;
    case 'simplify_text': return ai.features.simplify;
    case 'summarize': return ai.features.summarize;
    case 'generate_questions': return ai.features.questions;
    case 'correct_answer': return ai.features.correctAnswers;
    case 'question_on_text': return ai.features.questionOnText;
    case 'recognize_handwriting': return ai.handwritingRecognition;
  }
}

function tierFor(op: AIOperation, inputChars: number, settings: Pick<ParentSettings, 'ai'>, summarizeStage: 'chunk' | 'final'): 'light' | 'complex' {
  switch (op) {
    case 'explain_word':
    case 'correct_answer':
    case 'recognize_handwriting':
      return 'light';
    case 'explain_text':
    case 'simplify_text':
      return inputChars <= LIMITS.explainTextMaxChars ? 'light' : 'complex';
    case 'summarize':
      return summarizeStage === 'chunk' ? 'light' : 'complex';
    case 'generate_questions':
      return 'complex';
    case 'question_on_text':
      // Retrieval keeps the input small: light, unless the parent enabled deep questions and the retrieved text is long.
      return settings.ai.deepQuestions && inputChars > LIMITS.questionOnTextLightMaxChars ? 'complex' : 'light';
  }
}

/**
 * Route of an AI request. `inputChars`: length of the text sent to the model (selection, retrieved paragraphs, chunk…).
 * AI off / operation off → 'local'; complex tier with `allowComplexModel=false` → 'local'.
 * `summarize` without `summarizeStage` is treated as the final stage.
 */
export function routeFor(
  op: AIOperation,
  inputChars: number,
  settings: Pick<ParentSettings, 'ai'>,
  opts?: { summarizeStage?: 'chunk' | 'final' },
): AIRoute {
  if (!isAIOperationEnabled(op, settings)) return 'local';
  const tier = tierFor(op, inputChars, settings, opts?.summarizeStage ?? 'final');
  if (tier === 'complex' && !settings.ai.allowComplexModel) return 'local';
  return tier;
}
