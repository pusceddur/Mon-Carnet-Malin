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
  pinLockedUntil: MillisSchema.nullable(),
  registrationOpen: z.boolean(),
});

export const InvitationConfigSchema = z.object({
  enabled: z.boolean(),
  code: z.string().max(LIMITS.inviteCodeMaxChars),
  updatedAt: MillisSchema.nullable(),
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

export const SyncTableSchema = z.enum(['documents', 'pages', 'annotations', 'progress', 'sessions', 'exercises', 'answers', 'children']);

export const SyncRejectionSchema = z.object({
  table: SyncTableSchema,
  entityKey: z.string().min(1).max(100),
  reason: z.enum(['parent_locked', 'forbidden', 'invalid', 'stale']),
});

/** `cursor`: opaque server position (null = first sync). */
export const SyncRequestSchema = z.object({
  cursor: z.string().min(1).max(64).nullable(),
  deviceId: z.string().min(1).max(100),
  changes: SyncChangesSchema,
});

export const SyncResponseSchema = z.object({
  cursor: z.string().min(1).max(64),
  hasMore: z.boolean(),
  serverTime: MillisSchema,
  changes: SyncChangesSchema,
  rejected: z.array(SyncRejectionSchema),
});

export const OcrServerResultSchema = z.object({
  blocks: z.array(TextBlockSchema),
  confidence: z.number(),
  engine: z.literal('tesseract-best'),
});

export const ActivityAlertKindSchema = z.enum(['adult_redirect', 'safety_input', 'safety_output', 'injection_detected', 'budget_warning']);

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
    kind: ActivityAlertKindSchema,
    detail: z.string(),
    seenAt: MillisSchema.nullable(),
  })),
  ocrIssues: z.array(z.object({
    documentId: IdSchema,
    pageIndex: PageIndexSchema,
    confidence: z.number().nullable(),
    warnings: z.array(PageWarningSchema),
  })),
  budget: z.object({
    monthToDateEur: z.number().nonnegative(),
    monthlyBudgetEur: z.number().nonnegative(),
  }),
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

/** Invitation code chosen by the owner: stored upper-case, compared case-insensitively. */
export const InviteCodeSchema = z
  .string()
  .trim()
  .min(LIMITS.inviteCodeMinChars)
  .max(LIMITS.inviteCodeMaxChars)
  .regex(/^[A-Za-z0-9-]+$/)
  .transform((code) => code.toUpperCase());

/** POST /api/auth/register: any non-empty code is checked by the server (a wrong one counts as a failed attempt). */
export const RegisterRequestSchema = z.object({
  inviteCode: z.string().trim().min(1).max(LIMITS.inviteCodeMaxChars),
  email: EmailSchema,
  password: PasswordSchema,
  displayName: SetupRequestSchema.shape.displayName,
  pin: PinSchema,
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/** PUT /api/admin/invitation: `regenerate` and `code` are mutually exclusive. */
export const UpdateInvitationRequestSchema = z
  .object({
    enabled: z.boolean(),
    code: InviteCodeSchema.optional(),
    regenerate: z.boolean().optional(),
  })
  .refine((body) => !(body.regenerate === true && body.code !== undefined));
export type UpdateInvitationRequest = z.input<typeof UpdateInvitationRequestSchema>;

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

export const DIAGNOSTIC_LIMITS = { reportsMax: 20, messageMax: 500, stageMax: 40, contextKeysMax: 30, contextKeyMax: 40, contextValueMax: 200, userAgentMax: 400 } as const;

export const ClientDiagnosticKindSchema = z.enum(['ocr_engine', 'processing_failed', 'preprocess', 'pdf', 'self_test', 'other']);
export const DiagnosticValueSchema = z.union([z.string().max(DIAGNOSTIC_LIMITS.contextValueMax), z.number(), z.boolean(), z.null()]);
export const ClientDiagnosticReportSchema = z.object({
  kind: ClientDiagnosticKindSchema,
  message: z.string().max(DIAGNOSTIC_LIMITS.messageMax),
  stage: z.string().max(DIAGNOSTIC_LIMITS.stageMax).nullable(),
  context: z
    .record(z.string().max(DIAGNOSTIC_LIMITS.contextKeyMax), DiagnosticValueSchema)
    .refine((c) => Object.keys(c).length <= DIAGNOSTIC_LIMITS.contextKeysMax, 'too_many_keys'),
  userAgent: z.string().max(DIAGNOSTIC_LIMITS.userAgentMax),
  occurredAt: z.number().int().nonnegative(),
});
export const ClientDiagnosticsRequestSchema = z.object({
  reports: z.array(ClientDiagnosticReportSchema).min(1).max(DIAGNOSTIC_LIMITS.reportsMax),
});

export const OkResponseSchema = z.object({ ok: z.literal(true) });

export const WorkerStatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  lastSeenAt: MillisSchema.nullable(),
  limited: z.boolean(),
  limitResetsAt: MillisSchema.nullable(),
  queued: z.object({ ai: z.number().int().nonnegative(), pageText: z.number().int().nonnegative() }),
});

export const HealthStatusSchema = z.object({
  ok: z.literal(true),
  db: z.boolean(),
  ai: z.object({ light: z.boolean(), complex: z.boolean() }),
  ocr: z.object({ available: z.boolean(), busy: z.boolean() }),
});
