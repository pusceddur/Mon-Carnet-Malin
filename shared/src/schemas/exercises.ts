import { z } from 'zod';
import { LIMITS } from '../constants';
import { IdSchema, MillisSchema, PageIndexSchema, QuestionTypeSchema } from './common';

const shortText = z.string().min(1).max(1000);

export const SourceRefSchema = z.object({
  pageIndex: PageIndexSchema,
  quote: z.string().min(1).max(2000),
});

const QuestionBaseSchema = z.object({
  id: z.string().min(1).max(64),
  prompt: shortText,
  source: SourceRefSchema,
});

const PairSchema = z.object({ left: shortText, right: shortText });

export const QcmQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal('qcm'),
  choices: z.array(shortText).min(2).max(6),
  correctIndex: z.number().int().nonnegative(),
  explanation: z.string().max(1000),
});
export const VraiFauxQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal('vrai_faux'),
  answer: z.boolean(),
  explanation: z.string().max(1000),
});
export const ReponseLibreQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal('reponse_libre'),
  expectedAnswer: shortText,
  keyPoints: z.array(shortText).max(10),
});
export const AssociationQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal('association'),
  pairs: z.array(PairSchema).min(2).max(10),
});
export const OrdreQuestionSchema = QuestionBaseSchema.extend({
  type: z.literal('ordre'),
  itemsInOrder: z.array(shortText).min(2).max(10),
});

export const QuestionSchema = z.discriminatedUnion('type', [
  QcmQuestionSchema,
  VraiFauxQuestionSchema,
  ReponseLibreQuestionSchema,
  AssociationQuestionSchema,
  OrdreQuestionSchema,
]);

export const ExerciseSchema = z.object({
  id: IdSchema,
  childId: IdSchema,
  documentId: IdSchema,
  pageIndexes: z.array(PageIndexSchema).max(10000),
  questions: z.array(QuestionSchema).max(20),
  origin: z.enum(['ai', 'local']),
  createdAt: MillisSchema,
  updatedAt: MillisSchema,
  deletedAt: MillisSchema.nullable(),
});

export const AnswerResponseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('qcm'), choiceIndex: z.number().int().nonnegative() }),
  z.object({ type: z.literal('vrai_faux'), value: z.boolean() }),
  z.object({ type: z.literal('reponse_libre'), text: z.string().max(LIMITS.answerMaxChars) }),
  z.object({ type: z.literal('association'), pairs: z.array(PairSchema).max(10) }),
  z.object({ type: z.literal('ordre'), items: z.array(shortText).max(10) }),
]);

export const VerdictSchema = z.enum(['correct', 'partiel', 'incorrect']);

export const AnswerSchema = z.object({
  id: IdSchema,
  exerciseId: IdSchema,
  questionId: z.string().min(1).max(64),
  childId: IdSchema,
  response: AnswerResponseSchema,
  inputMethod: z.enum(['toucher', 'clavier', 'ecriture', 'dictee']),
  inkAnnotationId: IdSchema.nullable(),
  verdict: VerdictSchema.nullable(),
  feedback: z.string().max(2000).nullable(),
  correctedBy: z.enum(['local', 'ai']).nullable(),
  rereadRef: SourceRefSchema.nullable(),
  createdAt: MillisSchema,
  updatedAt: MillisSchema,
});
