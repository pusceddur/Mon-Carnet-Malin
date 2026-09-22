import { z } from 'zod';
import { LIMITS } from '../constants';
import { AIOperationSchema, AIRouteSchema, WritingChangeKindSchema, WritingChangeSchema } from './ai';
import { AnnotationSchema } from './annotations';
import { IdSchema, MillisSchema, PageIndexSchema } from './common';
import {
  ChildProfileSchema, DocumentMetaSchema, DocumentTextModeSchema, ExercisePreferencesSchema, ExplanationDifficultySchema, PageContentSchema,
  PageWarningSchema, ParentUserSchema, ReadingLevelSchema, ReadingPreferencesPatchSchema, ReadingProgressSchema,
  ReadingSessionSchema, TextBlockSchema, TTSPreferencesPatchSchema,
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
  // Defaults: answers of servers older than §20.
  pinRequired: z.boolean().default(true),
  passwordResetAvailable: z.boolean().default(false),
  aiReading: z.boolean().default(false),
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
    workerEstimateEur: z.number().nonnegative().default(0),
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

// ---------- §20 account security ----------
/** PUT /api/auth/pin-required: ask the code to open the Réglages, or not. The password confirms the change. */
export const PinRequiredRequestSchema = z.object({ required: z.boolean(), password: z.string().min(1).max(200) }).strict();
export type PinRequiredRequest = z.infer<typeof PinRequiredRequestSchema>;

/**
 * POST /api/auth/account/delete — §30: deleting the account for good, from the app or the browser.
 *
 * The password again, like every other change that cannot be undone. Nothing else is asked: a confirmation word to
 * type would only be one more thing to get wrong for a parent who has already decided.
 */
export const AccountDeleteRequestSchema = z.object({ password: z.string().min(1).max(200) }).strict();
export type AccountDeleteRequest = z.infer<typeof AccountDeleteRequestSchema>;

/** PUT /api/auth/device: name of this device in « Appareils connectés », sent by the app. */
export const DeviceNameRequestSchema = z.object({ name: z.string().trim().min(1).max(60) }).strict();
export type DeviceNameRequest = z.infer<typeof DeviceNameRequestSchema>;

/** POST /api/auth/password-reset: always answers ok (nobody learns whether an e-mail has an account). */
export const PasswordResetRequestSchema = z.object({ email: EmailSchema }).strict();
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

/** POST /api/auth/password-reset/confirm: link of the e-mail + code of the Réglages + new password. */
export const PasswordResetConfirmSchema = z.object({ token: z.string().min(20).max(200), pin: PinSchema, newPassword: PasswordSchema }).strict();
export type PasswordResetConfirm = z.infer<typeof PasswordResetConfirmSchema>;

/** POST /api/auth/continuity/confirm: link of the e-mail sent every 180 days. */
export const ContinuityConfirmSchema = z.object({ token: z.string().min(20).max(200) }).strict();
export type ContinuityConfirm = z.infer<typeof ContinuityConfirmSchema>;

export const DeviceKindSchema = z.enum(['ipad', 'iphone', 'mac', 'windows', 'android', 'linux', 'other']);
export const DeviceSessionSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  current: z.boolean(),
  name: z.string().nullable(),
  device: DeviceKindSchema,
  browser: z.string(),
  ip: z.string().nullable(),
  createdAt: MillisSchema,
  lastSeenAt: MillisSchema,
});
export const DeviceSessionsResponseSchema = z.object({ sessions: z.array(DeviceSessionSchema) });

/** POST /api/children: partial profile, server applies defaults. */
export const CreateChildRequestSchema = z.object({
  nickname: ChildProfileSchema.shape.nickname,
  avatar: ChildProfileSchema.shape.avatar.optional(),
  readingLevel: ReadingLevelSchema.optional(),
  explanationDifficulty: ExplanationDifficultySchema.optional(),
  reading: ReadingPreferencesPatchSchema.optional(),
  tts: TTSPreferencesPatchSchema.optional(),
  exercises: ExercisePreferencesSchema.partial().optional(),
});
export type CreateChildRequest = z.infer<typeof CreateChildRequestSchema>;

/** PUT /api/children/:id: full profile. */
export const UpdateChildRequestSchema = ChildProfileSchema;
export type UpdateChildRequest = z.infer<typeof UpdateChildRequestSchema>;

/** PATCH /api/children/:id/preferences */
export const UpdatePreferencesRequestSchema = z.object({
  reading: ReadingPreferencesPatchSchema.optional(),
  tts: TTSPreferencesPatchSchema.optional(),
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

export const DocumentTextModeRequestSchema = z.object({ textMode: DocumentTextModeSchema }).strict();
export const DocumentTextModeResponseSchema = z.object({
  document: DocumentMetaSchema,
  queued: z.number().int().nonnegative(),
});

export const OkResponseSchema = z.object({ ok: z.literal(true) });

export const FreeQuestionLogEntrySchema = z.object({
  id: IdSchema,
  childId: IdSchema,
  question: z.string(),
  outcome: z.enum(['answered', 'blocked', 'adult_redirect', 'unavailable']),
  answer: z.string().nullable(),
  createdAt: MillisSchema,
});
export const FreeQuestionHistorySchema = z.object({ entries: z.array(FreeQuestionLogEntrySchema) });

export const SubscriptionUsageSchema = z.object({
  status: z.enum(['allowed', 'allowed_warning', 'rejected']),
  window: z.enum(['session', 'week', 'other']).nullable(),
  utilization: z.number().min(0).max(100).nullable(),
  resetsAt: MillisSchema.nullable(),
  observedAt: MillisSchema.nullable(),
});

export const WorkerStatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  lastSeenAt: MillisSchema.nullable(),
  limited: z.boolean(),
  limitResetsAt: MillisSchema.nullable(),
  queued: z.object({ ai: z.number().int().nonnegative(), pageText: z.number().int().nonnegative(), pageSpeech: z.number().int().nonnegative().default(0) }),
  usage: SubscriptionUsageSchema.nullable().default(null),
  estimate: z.object({ monthToDateEur: z.number().nonnegative(), allAccountsEur: z.number().nonnegative().nullable() })
    .default({ monthToDateEur: 0, allAccountsEur: null }),
});

export const HealthStatusSchema = z.object({
  ok: z.literal(true),
  db: z.boolean(),
  ai: z.object({ light: z.boolean(), complex: z.boolean() }),
  ocr: z.object({ available: z.boolean(), busy: z.boolean() }),
});

// §22 « Préparer la lecture »
export const ReadingPreparationRequestSchema = z.object({
  pageIndexes: z.array(PageIndexSchema).min(1).max(2000).optional(),
  force: z.boolean().optional(),
});
export const ReadingPreparationResponseSchema = z.object({
  queued: z.number().int().nonnegative(),
  unavailable: z.enum(['not_configured', 'ai_disabled', 'text_not_synced']).nullable(),
});

// §24 texts corrected with « Corriger » (GET /api/activity/writing)
export const WritingCorrectionEntrySchema = z.object({
  id: IdSchema,
  childId: IdSchema,
  documentId: IdSchema.nullable(),
  originalText: z.string(),
  correctedText: z.string(),
  changes: z.array(WritingChangeSchema),
  createdAt: MillisSchema,
});
export const WritingCorrectionHistorySchema = z.object({
  entries: z.array(WritingCorrectionEntrySchema),
  counts: z.record(WritingChangeKindSchema, z.number().int().nonnegative()),
  frequent: z.array(z.object({ from: z.string(), to: z.string(), kind: WritingChangeKindSchema, count: z.number().int().positive() })),
});
