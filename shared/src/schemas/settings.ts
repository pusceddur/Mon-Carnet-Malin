import { z } from 'zod';
import { MillisSchema } from './common';

export const ParentSettingsSchema = z.object({
  ai: z.object({
    enabled: z.boolean(),
    features: z.object({
      explainWord: z.boolean(),
      explainText: z.boolean(),
      simplify: z.boolean(),
      summarize: z.boolean(),
      questions: z.boolean(),
      correctAnswers: z.boolean(),
      questionOnText: z.boolean(),
    }),
    dailyRequestLimitPerChild: z.number().int().min(0).max(1000),
    allowComplexModel: z.boolean(),
    handwritingRecognition: z.boolean(),
  }),
  ocr: z.object({
    autoServerFallback: z.boolean(),
    lowConfidenceThreshold: z.number().min(0).max(100),
  }),
  privacy: z.object({
    syncAnnotations: z.boolean(),
    syncDocumentText: z.boolean(),
    uploadOriginals: z.boolean(),
  }),
  updatedAt: MillisSchema,
});
