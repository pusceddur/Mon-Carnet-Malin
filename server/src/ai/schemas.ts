// JSON shapes produced by the model. Deliberately flat and constraint-free (structured-output friendly):
// every business rule is enforced afterwards by the validation pipeline.
import { z } from 'zod';
import type { AITransportOperation } from './plugin';

export const ModelStatusSchema = z.enum(['ok', 'not_in_text', 'cannot_help']);
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

export const ModelSourceRefSchema = z.object({ pageIndex: z.number(), quote: z.string() });

export const ModelExplanationSchema = z.object({
  status: ModelStatusSchema,
  explanation: z.string(),
  example: z.string().nullable(),
  sourceQuotes: z.array(z.string()),
});

export const ModelSimplificationSchema = z.object({
  status: ModelStatusSchema,
  simplifiedText: z.string(),
});

export const ModelChunkSummarySchema = z.object({
  status: ModelStatusSchema,
  summary: z.string(),
  keyQuotes: z.array(z.string()),
});

export const ModelSummarySchema = z.object({
  status: ModelStatusSchema,
  summary: z.string(),
  keyPoints: z.array(z.string()),
  sourceRefs: z.array(ModelSourceRefSchema),
});

export const ModelQuestionSchema = z.object({
  type: z.enum(['qcm', 'vrai_faux', 'reponse_libre', 'association', 'ordre']),
  prompt: z.string(),
  source: ModelSourceRefSchema,
  choices: z.array(z.string()).nullable(),
  correctIndex: z.number().nullable(),
  answer: z.boolean().nullable(),
  explanation: z.string().nullable(),
  expectedAnswer: z.string().nullable(),
  keyPoints: z.array(z.string()).nullable(),
  pairs: z.array(z.object({ left: z.string(), right: z.string() })).nullable(),
  itemsInOrder: z.array(z.string()).nullable(),
});

export const ModelQuestionsSchema = z.object({
  status: ModelStatusSchema,
  questions: z.array(ModelQuestionSchema),
});

export const ModelCorrectionSchema = z.object({
  status: ModelStatusSchema,
  verdict: z.enum(['correct', 'partiel', 'incorrect']),
  feedback: z.string(),
  rereadRef: ModelSourceRefSchema.nullable(),
});

export const ModelAnswerSchema = z.object({
  status: ModelStatusSchema,
  answer: z.string(),
  sourceRefs: z.array(ModelSourceRefSchema),
});

export const ModelHandwritingSchema = z.object({
  status: ModelStatusSchema,
  text: z.string(),
});

/**
 * §18 free question: no document, so no not_in_text. `redirect_adult`: the question reveals distress, danger or a secret
 * with an adult (the router answers with the adult-redirect message and alerts the parent). The limit of 3 suggestions is
 * applied by the validator (a 4th suggestion is dropped, it never costs a regeneration).
 */
export const ModelFreeAnswerStatusSchema = z.enum(['ok', 'cannot_help', 'redirect_adult']);
export const ModelFreeAnswerSchema = z.object({
  status: ModelFreeAnswerStatusSchema,
  answer: z.string(),
  example: z.string().nullable(),
  suggestions: z.array(z.string()),
});

/**
 * §24 « Corriger »: the corrected lines (as many as given) and, for the adult, one short explanation per correction. What
 * changed is computed by the server from the two texts, the notes only give the rule.
 */
export const ModelWritingSchema = z.object({
  status: ModelStatusSchema,
  lines: z.array(z.string()),
  notes: z.array(z.object({ from: z.string(), to: z.string(), rule: z.string() })),
});

export type ModelSourceRef = z.infer<typeof ModelSourceRefSchema>;
export type ModelExplanation = z.infer<typeof ModelExplanationSchema>;
export type ModelSimplification = z.infer<typeof ModelSimplificationSchema>;
export type ModelChunkSummary = z.infer<typeof ModelChunkSummarySchema>;
export type ModelSummary = z.infer<typeof ModelSummarySchema>;
export type ModelQuestion = z.infer<typeof ModelQuestionSchema>;
export type ModelQuestions = z.infer<typeof ModelQuestionsSchema>;
export type ModelCorrection = z.infer<typeof ModelCorrectionSchema>;
export type ModelAnswer = z.infer<typeof ModelAnswerSchema>;
export type ModelHandwriting = z.infer<typeof ModelHandwritingSchema>;
export type ModelFreeAnswer = z.infer<typeof ModelFreeAnswerSchema>;
export type ModelWriting = z.infer<typeof ModelWritingSchema>;
/** Every status a model output can carry (the router maps each one). */
export type ModelResultStatus = ModelStatus | z.infer<typeof ModelFreeAnswerStatusSchema>;

export const MODEL_SCHEMA_BY_TRANSPORT_OPERATION = {
  explain_word: ModelExplanationSchema,
  explain_text: ModelExplanationSchema,
  simplify_text: ModelSimplificationSchema,
  summarize: ModelSummarySchema,
  summarize_chunk: ModelChunkSummarySchema,
  summarize_final: ModelSummarySchema,
  generate_questions: ModelQuestionsSchema,
  correct_answer: ModelCorrectionSchema,
  question_on_text: ModelAnswerSchema,
  recognize_handwriting: ModelHandwritingSchema,
  free_question: ModelFreeAnswerSchema,
  correct_writing: ModelWritingSchema,
} as const satisfies Record<AITransportOperation, z.ZodType>;

const DROPPED_KEYWORDS = new Set(['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems']);

function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYWORDS.has(key)) continue;
    out[key === 'oneOf' ? 'anyOf' : key] = stripUnsupported(value);
  }
  return out;
}

const jsonSchemaCache = new Map<AITransportOperation, Record<string, unknown>>();

/** JSON Schema sent to the transport (z.toJSONSchema, without numeric/string/array bounds). */
export function modelJsonSchema(operation: AITransportOperation): Record<string, unknown> {
  const cached = jsonSchemaCache.get(operation);
  if (cached) return cached;
  const schema = stripUnsupported(z.toJSONSchema(MODEL_SCHEMA_BY_TRANSPORT_OPERATION[operation], { target: 'draft-7' })) as Record<string, unknown>;
  jsonSchemaCache.set(operation, schema);
  return schema;
}
