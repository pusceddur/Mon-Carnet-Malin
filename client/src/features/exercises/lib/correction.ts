import {
  correctClosedAnswer, LIMITS, newId, type AIPageInput, type Answer, type AnswerResponse, type Exercise, type Id, type Question,
  type SourceRef, type Verdict,
} from '@aide/shared';
import { requestAI } from '../../../ai/aiClient';
import { db } from '../../../db/localDb';
import { saveEntity } from '../../../sync/SyncEngine';
import { kidMessage } from './aiResults';
import { isReadablePage, pagesAroundSource, toAIPageInputs } from './documentPages';

export type InputMethod = Answer['inputMethod'];

export type CorrectionOutcome =
  | { kind: 'corrected'; verdict: Verdict; feedback: string; rereadRef: SourceRef | null; correctedBy: 'local' | 'ai' }
  /** No correction available (help offline/disabled, drawing only…): the child compares with the expected answer. */
  | { kind: 'self_check'; message: string | null }
  | { kind: 'adult_redirect'; message: string };

export interface CorrectionInput {
  question: Question;
  response: AnswerResponse;
  childId: Id;
  documentId: Id;
  documentHash: string | null;
  /** Pages around the question source (see pagesAroundSource). */
  pages: AIPageInput[];
  /** Parent settings allow the online correction of written answers. */
  aiAllowed: boolean;
  signal?: AbortSignal;
}

/** Pages sent with a written answer: the question source page and its neighbours among the exercise pages. */
export async function loadCorrectionPages(exercise: Exercise, question: Question): Promise<AIPageInput[]> {
  const wanted = new Set(exercise.pageIndexes);
  const pages = (await db.pages.where('documentId').equals(exercise.documentId).toArray())
    .filter((p) => (wanted.size === 0 || wanted.has(p.pageIndex)) && isReadablePage(p));
  const { inputs } = await toAIPageInputs(pagesAroundSource(pages, question.source.pageIndex));
  return inputs;
}

/** Closed questions: deterministic local correction. Written answers: online correction, else self-check. */
export async function correctResponse(input: CorrectionInput): Promise<CorrectionOutcome> {
  const { question, response } = input;

  if (question.type !== 'reponse_libre') {
    const local = correctClosedAnswer(question, response);
    if (!local) return { kind: 'self_check', message: null };
    return {
      kind: 'corrected',
      verdict: local.verdict,
      feedback: local.feedback,
      rereadRef: local.verdict === 'correct' ? null : question.source,
      correctedBy: 'local',
    };
  }

  const answerText = response.type === 'reponse_libre' ? response.text.trim().slice(0, LIMITS.answerMaxChars) : '';
  if (answerText.length === 0 || !input.aiAllowed || input.pages.length === 0) return { kind: 'self_check', message: null };

  const result = await requestAI(
    'correct_answer',
    { childId: input.childId, documentId: input.documentId, documentHash: input.documentHash, question, answerText, pages: input.pages },
    { signal: input.signal },
  );
  if (result.status === 'ok') {
    return {
      kind: 'corrected',
      verdict: result.data.verdict,
      feedback: result.data.feedback,
      rereadRef: result.data.rereadRef ?? (result.data.verdict === 'correct' ? null : question.source),
      correctedBy: 'ai',
    };
  }
  if (result.status === 'blocked' && result.reason === 'adult_redirect') return { kind: 'adult_redirect', message: kidMessage(result) };
  return { kind: 'self_check', message: kidMessage(result) };
}

export interface AnswerInput {
  exerciseId: Id;
  question: Question;
  childId: Id;
  response: AnswerResponse;
  inputMethod: InputMethod;
  inkAnnotationId: Id | null;
  outcome: CorrectionOutcome;
  now?: number;
}

export function buildAnswer(input: AnswerInput): Answer {
  const now = input.now ?? Date.now();
  const { outcome } = input;
  const base = {
    id: newId(),
    exerciseId: input.exerciseId,
    questionId: input.question.id,
    childId: input.childId,
    response: input.response,
    inputMethod: input.inputMethod,
    inkAnnotationId: input.inkAnnotationId,
    createdAt: now,
    updatedAt: now,
  };
  switch (outcome.kind) {
    case 'corrected':
      return { ...base, verdict: outcome.verdict, feedback: outcome.feedback, correctedBy: outcome.correctedBy, rereadRef: outcome.rereadRef };
    // The unavailability notice is transient: a saved self-check answer has no feedback.
    case 'self_check':
      return { ...base, verdict: null, feedback: null, correctedBy: null, rereadRef: input.question.source };
    case 'adult_redirect':
      return { ...base, verdict: null, feedback: outcome.message, correctedBy: null, rereadRef: null };
  }
}

/** Answer entity written through the sync engine (Dexie + outbox). */
export async function saveAnswer(answer: Answer): Promise<void> {
  await saveEntity('answers', answer);
}
