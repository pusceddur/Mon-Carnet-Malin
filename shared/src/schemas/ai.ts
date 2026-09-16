import { z } from 'zod';
import { LIMITS } from '../constants';
import { IdSchema, PageIndexSchema, QuestionTypeSchema, Sha256HexSchema } from './common';
import { QuestionCountSchema } from './domain';
import { QuestionSchema, ReponseLibreQuestionSchema, SourceRefSchema, VerdictSchema } from './exercises';

export const AIOperationSchema = z.enum([
  'explain_word', 'explain_text', 'simplify_text', 'summarize', 'generate_questions', 'correct_answer', 'question_on_text',
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

export const SummarizeStageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chunk'), chunkIndex: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('final') }),
]);

export const SummarizeRequestSchema = AIRequestBaseSchema.extend({
  level: SummaryLevelSchema,
  pages: PagesSchema,
  stage: SummarizeStageSchema,
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

/** Request schema per operation (route `/api/ai/:operation`). */
export const AIRequestSchemaByOperation = {
  explain_word: ExplainWordRequestSchema,
  explain_text: ExplainTextRequestSchema,
  simplify_text: SimplifyTextRequestSchema,
  summarize: SummarizeRequestSchema,
  generate_questions: GenerateQuestionsRequestSchema,
  correct_answer: CorrectAnswerRequestSchema,
  question_on_text: QuestionOnTextRequestSchema,
} as const;

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
export const ChunkSummaryDataSchema = z.object({ chunkIndex: z.number().int().nonnegative(), summary: z.string() });
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

export const AIMetaSchema = z.object({
  cached: z.boolean(),
  route: AIRouteSchema,
  promptVersion: z.string(),
  sourceWarning: z.boolean(),
  requestId: z.string(),
});

export const AIBlockedReasonSchema = z.enum(['safety_input', 'safety_output', 'validation', 'refusal', 'adult_redirect']);
export const AIUnavailableReasonSchema = z.enum([
  'ai_disabled', 'feature_disabled', 'quota', 'offline', 'provider_error', 'not_configured', 'missing_chunks', 'timeout',
]);

/** Builds the `AIResult<T>` schema for a given data schema. */
export function AIResultSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('status', [
    z.object({ status: z.literal('ok'), data, meta: AIMetaSchema }),
    z.object({ status: z.literal('not_in_text'), message: z.string(), meta: AIMetaSchema }),
    z.object({ status: z.literal('blocked'), reason: AIBlockedReasonSchema, message: z.string(), meta: AIMetaSchema }),
    z.object({ status: z.literal('unavailable'), reason: AIUnavailableReasonSchema, message: z.string(), meta: AIMetaSchema.nullable() }),
  ]);
}
