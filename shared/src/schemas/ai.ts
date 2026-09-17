import { z } from 'zod';
import { LIMITS, PREFERENCE_RANGES } from '../constants';
import type { AIOperation } from '../types/ai';
import { IdSchema, PageIndexSchema, QuestionTypeSchema, Sha256HexSchema } from './common';
import { ExplanationDifficultySchema, QuestionCountSchema, ReadingLevelSchema } from './domain';
import { QuestionSchema, ReponseLibreQuestionSchema, SourceRefSchema, VerdictSchema } from './exercises';

export const AIOperationSchema = z.enum([
  'explain_word', 'explain_text', 'simplify_text', 'summarize', 'generate_questions', 'correct_answer', 'question_on_text',
  'recognize_handwriting',
]);
export const AIRouteSchema = z.enum(['local', 'light', 'complex']);
export const SummaryLevelSchema = z.enum(['bref', 'normal', 'detaille']);

export const AIPageInputSchema = z.object({
  pageIndex: PageIndexSchema,
  text: z.string().max(LIMITS.pagesMaxTotalChars),
  contentHash: Sha256HexSchema,
  ocrLowConfidence: z.boolean(),
});

const PagesSchema = z
  .array(AIPageInputSchema)
  .min(1)
  .max(1000)
  .refine((pages) => pages.reduce((n, p) => n + p.text.length, 0) <= LIMITS.pagesMaxTotalChars, {
    message: 'pages_too_long',
  });

export const AIRequestBaseSchema = z.object({
  childId: IdSchema,
  documentId: IdSchema.nullable(),
  documentHash: Sha256HexSchema.nullable(),
});

export const ExplainWordRequestSchema = AIRequestBaseSchema.extend({
  word: z.string().trim().min(1).max(LIMITS.wordMaxChars),
  sentence: z.string().max(LIMITS.selectionMaxChars),
  paragraph: z.string().max(LIMITS.paragraphMaxChars),
  pageIndex: PageIndexSchema,
  ocrLowConfidence: z.boolean(),
});

export const ExplainTextRequestSchema = AIRequestBaseSchema.extend({
  text: z.string().trim().min(1).max(LIMITS.selectionMaxChars),
  paragraph: z.string().max(LIMITS.paragraphMaxChars),
  pageIndex: PageIndexSchema,
  ocrLowConfidence: z.boolean(),
});

export const SimplifyTextRequestSchema = AIRequestBaseSchema.extend({
  text: z.string().trim().min(1).max(LIMITS.selectionMaxChars),
  pageIndex: PageIndexSchema,
  ocrLowConfidence: z.boolean(),
});

export const TextChunkSchema = z.object({
  chunkIndex: z.number().int().nonnegative().max(LIMITS.summarizeMaxChunks - 1),
  pageIndexes: z.array(PageIndexSchema).min(1).max(1000),
  text: z.string().min(1).max(LIMITS.chunkTextMaxChars),   // not trimmed: must match contentHash
  contentHash: Sha256HexSchema,
});

export const SummarizeStageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chunk'), planHash: Sha256HexSchema, chunk: TextChunkSchema }),
  z.object({ kind: z.literal('final'), planHash: Sha256HexSchema, chunkCount: z.number().int().min(1).max(LIMITS.summarizeMaxChunks) }),
]);

/** §15.4: no `pages`; the chunk stage carries its own text, the final stage carries none. */
export const SummarizeRequestSchema = AIRequestBaseSchema.extend({
  level: SummaryLevelSchema,
  stage: SummarizeStageSchema,
  ocrLowConfidence: z.boolean(),
});

export const GenerateQuestionsRequestSchema = AIRequestBaseSchema.extend({
  count: QuestionCountSchema,
  types: z.array(QuestionTypeSchema).min(1).max(5),
  pages: PagesSchema,
});

export const CorrectAnswerRequestSchema = AIRequestBaseSchema.extend({
  question: ReponseLibreQuestionSchema,
  answerText: z.string().max(LIMITS.answerMaxChars),
  pages: PagesSchema,
});

export const QuestionOnTextRequestSchema = AIRequestBaseSchema.extend({
  question: z.string().trim().min(1).max(LIMITS.questionOnTextMaxChars),
  pages: PagesSchema,
});

/** Base64 (without data: prefix) of a PNG of at most LIMITS.handwritingImageMaxBytes. */
export const RecognizeHandwritingRequestSchema = AIRequestBaseSchema.extend({
  imagePngBase64: z
    .string()
    .min(1)
    .max(Math.ceil(LIMITS.handwritingImageMaxBytes / 3) * 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

/** Request schema per operation (route `/api/ai/:operation`). */
export const AIRequestSchemaByOperation = {
  explain_word: ExplainWordRequestSchema,
  explain_text: ExplainTextRequestSchema,
  simplify_text: SimplifyTextRequestSchema,
  summarize: SummarizeRequestSchema,
  generate_questions: GenerateQuestionsRequestSchema,
  correct_answer: CorrectAnswerRequestSchema,
  question_on_text: QuestionOnTextRequestSchema,
  recognize_handwriting: RecognizeHandwritingRequestSchema,
} as const satisfies Record<AIOperation, z.ZodType>;

/** Learner profile sent to providers (never the child's name or id). */
export const AILearnerSchema = z.object({
  age: z.number().int().min(PREFERENCE_RANGES.childAge.min).max(PREFERENCE_RANGES.childAge.max),
  readingLevel: ReadingLevelSchema,
  explanationDifficulty: ExplanationDifficultySchema,
});

export const ExplanationDataSchema = z.object({
  explanation: z.string(),
  example: z.string().nullable(),
  sourceQuotes: z.array(z.string()),
});
export const SimplifyDataSchema = z.object({ simplifiedText: z.string() });
export const SummaryDataSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  sourceRefs: z.array(SourceRefSchema),
});
export const ChunkSummaryDataSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  summary: z.string(),
  keyQuotes: z.array(SourceRefSchema).min(LIMITS.chunkKeyQuotesMin).max(LIMITS.chunkKeyQuotesMax),
});
export const QuestionsDataSchema = z.object({ questions: z.array(QuestionSchema) });
export const CorrectionDataSchema = z.object({
  verdict: VerdictSchema,
  feedback: z.string(),
  rereadRef: SourceRefSchema.nullable(),
});
export const QuestionOnTextDataSchema = z.object({
  answer: z.string(),
  sourceRefs: z.array(SourceRefSchema),
});
export const HandwritingDataSchema = z.object({ text: z.string() });

/** Data schema per operation (`summarize`: chunk stage or final stage). */
export const AIDataSchemaByOperation = {
  explain_word: ExplanationDataSchema,
  explain_text: ExplanationDataSchema,
  simplify_text: SimplifyDataSchema,
  summarize: z.union([ChunkSummaryDataSchema, SummaryDataSchema]),
  generate_questions: QuestionsDataSchema,
  correct_answer: CorrectionDataSchema,
  question_on_text: QuestionOnTextDataSchema,
  recognize_handwriting: HandwritingDataSchema,
} as const satisfies Record<AIOperation, z.ZodType>;

export const AIMetaSchema = z.object({
  cached: z.boolean(),
  route: AIRouteSchema,
  promptVersion: z.string(),
  sourceWarning: z.boolean(),
  requestId: z.string(),
});

export const AIBlockedReasonSchema = z.enum(['safety_input', 'safety_output', 'validation', 'refusal', 'adult_redirect']);
export const AIUnavailableReasonSchema = z.enum([
  'ai_disabled', 'feature_disabled', 'quota', 'budget', 'offline', 'provider_error', 'not_configured', 'missing_chunks', 'timeout',
  'payload_too_large', 'busy',
]);

function aiResultOptions<T extends z.ZodType>(data: T) {
  return [
    z.object({ status: z.literal('ok'), data, meta: AIMetaSchema }),
    z.object({ status: z.literal('not_in_text'), message: z.string(), meta: AIMetaSchema }),
    z.object({ status: z.literal('blocked'), reason: AIBlockedReasonSchema, message: z.string(), meta: AIMetaSchema }),
    z.object({
      status: z.literal('unavailable'),
      reason: AIUnavailableReasonSchema,
      message: z.string(),
      meta: AIMetaSchema.nullable(),
      missingChunkIndexes: z.array(z.number().int().nonnegative()).optional(),
    }),
  ] as const;
}

/** Builds the `AIResult<T>` schema for a given data schema. */
export function AIResultSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('status', aiResultOptions(data));
}

/** 202 body of `POST /api/ai/:operation` when the route is `complex` (§15.4). */
export const AIJobAcceptedSchema = z.object({
  status: z.literal('pending'),
  jobId: IdSchema,
  pollAfterMs: z.number().int().nonnegative(),
  waitMs: z.number().int().positive().optional(),
});

/** Builds the `AIJobPoll<T>` schema (`GET /api/ai/jobs/:jobId`) for a given data schema. */
export function AIJobPollSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('status', [
    z.object({ status: z.literal('pending'), pollAfterMs: z.number().int().nonnegative() }),
    ...aiResultOptions(data),
  ]);
}
