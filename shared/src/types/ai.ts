import type { Id } from './domain';
import type { Question, QuestionType, SourceRef, Verdict } from './exercises';

export type AIOperation = 'explain_word' | 'explain_text' | 'simplify_text' | 'summarize' | 'generate_questions' | 'correct_answer' | 'question_on_text';
export type AIRoute = 'local' | 'light' | 'complex';
export interface AIPageInput { pageIndex: number; text: string; contentHash: string; ocrLowConfidence: boolean }
export interface AIRequestBase { childId: Id; documentId: Id | null; documentHash: string | null }
export interface ExplainWordRequest extends AIRequestBase { word: string; sentence: string; paragraph: string; pageIndex: number; ocrLowConfidence: boolean }
export interface ExplainTextRequest extends AIRequestBase { text: string; paragraph: string; pageIndex: number; ocrLowConfidence: boolean }
export interface SimplifyTextRequest extends AIRequestBase { text: string; pageIndex: number; ocrLowConfidence: boolean }
export type SummaryLevel = 'bref' | 'normal' | 'detaille';
export interface SummarizeRequest extends AIRequestBase { level: SummaryLevel; pages: AIPageInput[]; stage: { kind: 'chunk'; chunkIndex: number } | { kind: 'final' } }
export interface GenerateQuestionsRequest extends AIRequestBase { count: 3 | 5 | 10; types: QuestionType[]; pages: AIPageInput[] }
export interface CorrectAnswerRequest extends AIRequestBase { question: Extract<Question, { type: 'reponse_libre' }>; answerText: string; pages: AIPageInput[] }
export interface QuestionOnTextRequest extends AIRequestBase { question: string; pages: AIPageInput[] }

export interface ExplanationData { explanation: string; example: string | null; sourceQuotes: string[] }
export interface SimplifyData { simplifiedText: string }
export interface SummaryData { summary: string; keyPoints: string[]; sourceRefs: SourceRef[] }
export interface ChunkSummaryData { chunkIndex: number; summary: string }
export interface QuestionsData { questions: Question[] }
export interface CorrectionData { verdict: Verdict; feedback: string; rereadRef: SourceRef | null }
export interface QuestionOnTextData { answer: string; sourceRefs: SourceRef[] }

export interface AIMeta { cached: boolean; route: AIRoute; promptVersion: string; sourceWarning: boolean; requestId: string }
export type AIResult<T> =
  | { status: 'ok'; data: T; meta: AIMeta }
  | { status: 'not_in_text'; message: string; meta: AIMeta }
  | { status: 'blocked'; reason: 'safety_input' | 'safety_output' | 'validation' | 'refusal' | 'adult_redirect'; message: string; meta: AIMeta }
  | { status: 'unavailable'; reason: 'ai_disabled' | 'feature_disabled' | 'quota' | 'offline' | 'provider_error' | 'not_configured' | 'missing_chunks' | 'timeout'; message: string; meta: AIMeta | null };
// The client NEVER receives provider/model names. Provider/model only in ai_requests (parent area).

// ---------- additions (foundations): operation -> request/data maps ----------
export interface AIRequestByOperation {
  explain_word: ExplainWordRequest;
  explain_text: ExplainTextRequest;
  simplify_text: SimplifyTextRequest;
  summarize: SummarizeRequest;
  generate_questions: GenerateQuestionsRequest;
  correct_answer: CorrectAnswerRequest;
  question_on_text: QuestionOnTextRequest;
}
export interface AIDataByOperation {
  explain_word: ExplanationData;
  explain_text: ExplanationData;
  simplify_text: SimplifyData;
  summarize: ChunkSummaryData | SummaryData;   // chunk stage -> ChunkSummaryData, final stage -> SummaryData
  generate_questions: QuestionsData;
  correct_answer: CorrectionData;
  question_on_text: QuestionOnTextData;
}
export type RequestFor<Op extends AIOperation> = AIRequestByOperation[Op];
export type DataFor<Op extends AIOperation> = AIDataByOperation[Op];
export type AIBlockedReason = Extract<AIResult<unknown>, { status: 'blocked' }>['reason'];
export type AIUnavailableReason = Extract<AIResult<unknown>, { status: 'unavailable' }>['reason'];
