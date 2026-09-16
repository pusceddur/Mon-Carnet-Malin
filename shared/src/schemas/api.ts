import { z } from 'zod';
import { LIMITS } from '../constants';
import { AIOperationSchema, AIRouteSchema } from './ai';
import { AnnotationSchema } from './annotations';
import { IdSchema, MillisSchema, PageIndexSchema } from './common';
import {
  ChildProfileSchema, DocumentMetaSchema, ExercisePreferencesSchema, ExplanationDifficultySchema, PageContentSchema,
  PageWarningSchema, ParentUserSchema, ReadingLevelSchema, ReadingPreferencesSchema, ReadingProgressSchema,
  ReadingSessionSchema, TextBlockSchema, TTSPreferencesSchema,
} from './domain';
import { AnswerSchema, ExerciseSchema } from './exercises';

export const ApiErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const AuthStatusSchema = z.object({
  setupRequired: z.boolean(),
  authenticated: z.boolean(),
  parent: ParentUserSchema.nullable(),
  parentUnlockedUntil: MillisSchema.nullable(),
  pinSet: z.boolean(),
});

export const SyncChangesSchema = z.object({
  documents: z.array(DocumentMetaSchema),
  pages: z.array(PageContentSchema),
  annotations: z.array(AnnotationSchema),
  progress: z.array(ReadingProgressSchema),
  sessions: z.array(ReadingSessionSchema),
  exercises: z.array(ExerciseSchema),
  answers: z.array(AnswerSchema),
  children: z.array(ChildProfileSchema),
});

export const SyncRequestSchema = z.object({
  since: MillisSchema,
  deviceId: z.string().min(1).max(100),
  changes: SyncChangesSchema,
});

export const SyncResponseSchema = z.object({
  serverTime: MillisSchema,
  changes: SyncChangesSchema,
});

export const OcrServerResultSchema = z.object({
  blocks: z.array(TextBlockSchema),
  confidence: z.number(),
  engine: z.literal('tesseract-best'),
});

export const ActivitySummarySchema = z.object({
  sessions: z.array(ReadingSessionSchema),
  aiRequests: z.array(z.object({
    id: IdSchema,
    createdAt: MillisSchema,
    childId: IdSchema.nullable(),
    operation: AIOperationSchema,
    route: AIRouteSchema,
    provider: z.string(),
    model: z.string(),
    status: z.string(),
    rejectionReason: z.string().nullable(),
    cacheHit: z.boolean(),
    durationMs: z.number().nonnegative(),
  })),
  alerts: z.array(z.object({
    id: IdSchema,
    createdAt: MillisSchema,
    childId: IdSchema.nullable(),
    kind: z.enum(['adult_redirect', 'safety_input', 'safety_output', 'injection_detected']),
    detail: z.string(),
  })),
  ocrIssues: z.array(z.object({
    documentId: IdSchema,
    pageIndex: PageIndexSchema,
    confidence: z.number().nullable(),
    warnings: z.array(PageWarningSchema),
  })),
});

// ---------- request bodies of §7 (additions: foundations) ----------
const EmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const PasswordSchema = z.string().min(LIMITS.passwordMinChars).max(200);
const PinSchema = z.string().regex(new RegExp(`^\\d{${LIMITS.pinMinDigits},${LIMITS.pinMaxDigits}}$`));

export const SetupRequestSchema = z.object({
  setupToken: z.string().min(1).max(500),
  email: EmailSchema,
  password: PasswordSchema,
  displayName: z.string().trim().min(1).max(80),
  pin: PinSchema,
});
export type SetupRequest = z.infer<typeof SetupRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UnlockRequestSchema = z.object({ pin: PinSchema });
export type UnlockRequest = z.infer<typeof UnlockRequestSchema>;

export const ChangePinRequestSchema = z.object({ password: z.string().min(1).max(200), newPin: PinSchema });
export type ChangePinRequest = z.infer<typeof ChangePinRequestSchema>;

export const ChangePasswordRequestSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: PasswordSchema });
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

/** POST /api/children: partial profile, server applies defaults. */
export const CreateChildRequestSchema = z.object({
  firstName: ChildProfileSchema.shape.firstName,
  age: ChildProfileSchema.shape.age.optional(),
  avatar: ChildProfileSchema.shape.avatar.optional(),
  readingLevel: ReadingLevelSchema.optional(),
  explanationDifficulty: ExplanationDifficultySchema.optional(),
  reading: ReadingPreferencesSchema.partial().optional(),
  tts: TTSPreferencesSchema.partial().optional(),
  exercises: ExercisePreferencesSchema.partial().optional(),
});
export type CreateChildRequest = z.infer<typeof CreateChildRequestSchema>;

/** PUT /api/children/:id: full profile. */
export const UpdateChildRequestSchema = ChildProfileSchema;
export type UpdateChildRequest = z.infer<typeof UpdateChildRequestSchema>;

/** PATCH /api/children/:id/preferences */
export const UpdatePreferencesRequestSchema = z.object({
  reading: ReadingPreferencesSchema.partial().optional(),
  tts: TTSPreferencesSchema.partial().optional(),
});
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequestSchema>;

/** GET /api/activity query */
export const ActivityQuerySchema = z.object({
  childId: IdSchema.optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
});
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;

/** GET /api/dictionary query */
export const DictionaryQuerySchema = z.object({
  word: z.string().trim().min(1).max(LIMITS.wordMaxChars),
});
export type DictionaryQuery = z.infer<typeof DictionaryQuerySchema>;

/** POST /api/ai/handwriting (base64 of <= 2 MB PNG) */
export const HandwritingRequestSchema = z.object({
  childId: IdSchema,
  imagePngBase64: z.string().min(1).max(Math.ceil((LIMITS.handwritingImageMaxBytes * 4) / 3) + 4),
});
export type HandwritingRequest = z.infer<typeof HandwritingRequestSchema>;

export const HandwritingResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), text: z.string() }),
  z.object({ status: z.enum(['unavailable', 'blocked']), message: z.string() }),
]);

export const OkResponseSchema = z.object({ ok: z.literal(true) });

export const HealthStatusSchema = z.object({
  ok: z.literal(true),
  db: z.boolean(),
  ai: z.object({ light: z.boolean(), complex: z.boolean() }),
});
