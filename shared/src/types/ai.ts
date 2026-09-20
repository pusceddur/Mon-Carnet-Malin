import type { TextChunk } from '../ai/chunks';
import type { ExplanationDifficulty, Id, ReadingLevel } from './domain';
import type { Question, QuestionType, SourceRef, Verdict } from './exercises';

export type AIOperation =
  | 'explain_word' | 'explain_text' | 'simplify_text' | 'summarize' | 'generate_questions' | 'correct_answer' | 'question_on_text'
  | 'recognize_handwriting' | 'free_question' | 'correct_writing';
export type AIRoute = 'local' | 'light' | 'complex';
export interface AIPageInput { pageIndex: number; text: string; contentHash: string; ocrLowConfidence: boolean }
export interface AIRequestBase { childId: Id; documentId: Id | null; documentHash: string | null }
export interface ExplainWordRequest extends AIRequestBase { word: string; sentence: string; paragraph: string; pageIndex: number; ocrLowConfidence: boolean }
export interface ExplainTextRequest extends AIRequestBase { text: string; paragraph: string; pageIndex: number; ocrLowConfidence: boolean }
export interface SimplifyTextRequest extends AIRequestBase { text: string; pageIndex: number; ocrLowConfidence: boolean }
export type SummaryLevel = 'bref' | 'normal' | 'detaille';
// §15.4: chunk stage sends only its own text (light route); final stage sends no text, the server reads chunk results from its cache.
export type SummarizeStage =
  | { kind: 'chunk'; planHash: string; chunk: TextChunk }
  | { kind: 'final'; planHash: string; chunkCount: number };
export interface SummarizeRequest extends AIRequestBase { level: SummaryLevel; stage: SummarizeStage; ocrLowConfidence: boolean }
export interface GenerateQuestionsRequest extends AIRequestBase { count: 3 | 5 | 10; types: QuestionType[]; pages: AIPageInput[] }
export interface CorrectAnswerRequest extends AIRequestBase { question: Extract<Question, { type: 'reponse_libre' }>; answerText: string; pages: AIPageInput[] }
export interface QuestionOnTextRequest extends AIRequestBase { question: string; pages: AIPageInput[] }
export interface RecognizeHandwritingRequest extends AIRequestBase { imagePngBase64: string }
// §18: question typed by the user, not tied to a book (documentId/documentHash null). `previous`: the last exchange, for
// « Je n'ai pas compris » (mode simpler) and follow-up questions; `mode` simpler asks for an easier answer.
export interface FreeQuestionRequest extends Omit<AIRequestBase, 'documentId' | 'documentHash'> {
  documentId: null;
  documentHash: null;
  question: string;
  previous: { question: string; answer: string } | null;
  mode: 'normal' | 'simpler';
}

// §24 « Corriger » in a text box: spelling, grammar and punctuation of the child's own text, same lines, words and meaning.
export interface CorrectWritingRequest extends AIRequestBase {
  text: string;                     // ≤ TEXT_BOX_MAX_CHARS, ≤ LIMITS.writingMaxLines lines
  annotationId: Id | null;          // the text box, for the history
  pageIndex: number | null;
}
export type WritingChangeKind = 'accent' | 'orthographe' | 'grammaire' | 'ponctuation' | 'majuscule' | 'espace';
/** One correction, found by comparing the two texts (not trusted from the model); `rule`: short explanation for the adult. */
export interface WritingChange { line: number /* 0-based */; from: string; to: string; kind: WritingChangeKind; rule: string | null }
export interface CorrectWritingData { correctedText: string; changes: WritingChange[] }

export interface ExplanationData { explanation: string; example: string | null; sourceQuotes: string[] }
export interface SimplifyData { simplifiedText: string }
export interface SummaryData { summary: string; keyPoints: string[]; sourceRefs: SourceRef[] }
export interface ChunkSummaryData { chunkIndex: number; summary: string; keyQuotes: SourceRef[] /* 1..3, verified against the chunk */ }
export interface QuestionsData { questions: Question[] }
export interface CorrectionData { verdict: Verdict; feedback: string; rereadRef: SourceRef | null }
export interface QuestionOnTextData { answer: string; sourceRefs: SourceRef[] }
export interface HandwritingData { text: string }
export interface FreeQuestionData { answer: string; example: string | null; suggestions: string[] /* 0..3 short follow-up questions */ }

// Learner profile sent to providers: never the child's name or id.
export interface AILearner { age: number; readingLevel: ReadingLevel; explanationDifficulty: ExplanationDifficulty }

export type AIBlockedReason = 'safety_input' | 'safety_output' | 'validation' | 'refusal' | 'adult_redirect';
export type AIUnavailableReason =
  | 'ai_disabled' | 'feature_disabled' | 'quota' | 'budget' | 'offline' | 'provider_error' | 'not_configured' | 'missing_chunks'
  | 'timeout' | 'payload_too_large' | 'busy';

export interface AIMeta { cached: boolean; route: AIRoute; promptVersion: string; sourceWarning: boolean; requestId: string }
export type AIResult<T> =
  | { status: 'ok'; data: T; meta: AIMeta }
  | { status: 'not_in_text'; message: string; meta: AIMeta }
  | { status: 'blocked'; reason: AIBlockedReason; message: string; meta: AIMeta }
  | { status: 'unavailable'; reason: AIUnavailableReason; message: string; meta: AIMeta | null; missingChunkIndexes?: number[] };
// The client NEVER receives provider/model names. Provider/model only in ai_requests (parent area).

// §15.4: every `complex` route answers 202 AIJobAccepted; GET /api/ai/jobs/:jobId answers AIJobPoll.
// `waitMs`: how long the client may keep polling (external worker deadlines, §17); absent = AI_DEADLINES.complex.
export interface AIJobAccepted { status: 'pending'; jobId: string; pollAfterMs: number; waitMs?: number }
export type AIJobPoll<T> = { status: 'pending'; pollAfterMs: number } | AIResult<T>;

// ---------- operation -> request/data maps ----------
export interface AIRequestByOperation {
  explain_word: ExplainWordRequest;
  explain_text: ExplainTextRequest;
  simplify_text: SimplifyTextRequest;
  summarize: SummarizeRequest;
  generate_questions: GenerateQuestionsRequest;
  correct_answer: CorrectAnswerRequest;
  question_on_text: QuestionOnTextRequest;
  recognize_handwriting: RecognizeHandwritingRequest;
  free_question: FreeQuestionRequest;
  correct_writing: CorrectWritingRequest;
}
export interface AIDataByOperation {
  explain_word: ExplanationData;
  explain_text: ExplanationData;
  simplify_text: SimplifyData;
  summarize: ChunkSummaryData | SummaryData;   // chunk stage -> ChunkSummaryData, final stage -> SummaryData
  generate_questions: QuestionsData;
  correct_answer: CorrectionData;
  question_on_text: QuestionOnTextData;
  recognize_handwriting: HandwritingData;
  free_question: FreeQuestionData;
  correct_writing: CorrectWritingData;
}
export type RequestFor<Op extends AIOperation> = AIRequestByOperation[Op];
export type DataFor<Op extends AIOperation> = AIDataByOperation[Op];
