import type { AIOperation, AIRoute, WritingChange, WritingChangeKind } from './ai';
import type { Annotation } from './annotations';
import type {
  ChildProfile, DocumentMeta, DocumentTextMode, Id, Millis, PageContent, PageWarning, ParentUser, ReadingProgress, ReadingSession,
  TextBlock,
} from './domain';
import type { Answer, Exercise } from './exercises';

export interface ApiErrorBody { error: { code: string; message: string /* French */ } }
export interface AuthStatus {
  setupRequired: boolean; authenticated: boolean; parent: ParentUser | null; parentUnlockedUntil: Millis | null; pinSet: boolean;
  pinLockedUntil: Millis | null;   // §15.8: PIN attempts locked until this time
  registrationOpen: boolean;       // accounts can be created with an invitation code
  pinRequired: boolean;            // §20: false = the Réglages open without the code (the PIN still exists)
  passwordResetAvailable: boolean; // §20: « Mot de passe oublié » works (e-mails configured on the server)
  aiReading: boolean;              // §25: the home computer reads the page images (worker configured on the server)
  /**
   * §29: session token of a freshly opened session, sent only to a client that asked for it (`X-Aide-Client: native`).
   * The bundled app is not same-origin with the server, so it has no cookie jar: it keeps this token itself and sends it
   * back as `Authorization: Bearer …`. The browser app never receives it and keeps using its httpOnly cookie.
   */
  sessionToken?: string;
}

// ---------- §20 account security ----------
export type DeviceKind = 'ipad' | 'iphone' | 'mac' | 'windows' | 'android' | 'linux' | 'other';
/** A signed-in device of the account (« Appareils connectés »). */
export interface DeviceSession {
  /** Public id (not the session token nor its hash). */
  id: string;
  current: boolean;
  /** Name sent by the app (« iPad · app installée »), null for older sessions. */
  name: string | null;
  device: DeviceKind;
  browser: string;
  /** Last known IP address, null when unknown. */
  ip: string | null;
  createdAt: Millis;
  lastSeenAt: Millis;
}
export interface DeviceSessionsResponse { sessions: DeviceSession[] }

/** Invitation settings managed by the owner account (GET/PUT /api/admin/invitation). */
export interface InvitationConfig { enabled: boolean; code: string /* '' when none yet */; updatedAt: Millis | null }

// ---------- sync (§15.2) ----------
export interface SyncChanges {
  documents: DocumentMeta[]; pages: PageContent[]; annotations: Annotation[]; progress: ReadingProgress[];
  sessions: ReadingSession[]; exercises: Exercise[]; answers: Answer[]; children: ChildProfile[];
}
export type SyncTable = keyof SyncChanges;
export type SyncEntity<T extends SyncTable> = SyncChanges[T][number];
export type SyncRejectionReason = 'parent_locked' | 'forbidden' | 'invalid' | 'stale';
export interface SyncRejection { table: SyncTable; entityKey: string /* syncEntityKey() */; reason: SyncRejectionReason }
export interface SyncRequest { cursor: string | null; deviceId: string; changes: SyncChanges }
export interface SyncResponse { cursor: string; hasMore: boolean; serverTime: Millis; changes: SyncChanges; rejected: SyncRejection[] }

export interface OcrServerResult { blocks: TextBlock[]; confidence: number; engine: 'tesseract-best' }

// ---------- activity (§7, §15.4, §15.10) ----------
// 'budget_warning': monthly AI budget reached 80% (§15.4, once per month).
export type ActivityAlertKind = 'adult_redirect' | 'safety_input' | 'safety_output' | 'injection_detected' | 'budget_warning';
export interface ActivitySummary {
  sessions: ReadingSession[];
  aiRequests: { id: Id; createdAt: Millis; childId: Id | null; operation: AIOperation; route: AIRoute; provider: string; model: string;
                status: string; rejectionReason: string | null; cacheHit: boolean; durationMs: number }[];
  alerts: { id: Id; createdAt: Millis; childId: Id | null; kind: ActivityAlertKind; detail: string; seenAt: Millis | null }[];
  ocrIssues: { documentId: Id; pageIndex: number; confidence: number | null; warnings: PageWarning[] }[];
  /**
   * monthToDateEur: AI paid per use (counts against the budget). §21 workerEstimateEur: what the requests run by the
   * home computer this month would cost at list prices; the subscription is flat-rate, so it is only shown, never blocks.
   */
  budget: { monthToDateEur: number; monthlyBudgetEur: number; workerEstimateEur: number };
}

// ---------- client diagnostics (technical problems seen on a device; never document text) ----------
export type ClientDiagnosticKind = 'ocr_engine' | 'processing_failed' | 'preprocess' | 'pdf' | 'self_test' | 'other';
export type DiagnosticValue = string | number | boolean | null;
export interface ClientDiagnosticReport {
  kind: ClientDiagnosticKind;
  message: string;
  stage: string | null;
  context: Record<string, DiagnosticValue>;
  userAgent: string;
  occurredAt: Millis;
}
export interface ClientDiagnosticsRequest { reports: ClientDiagnosticReport[] }

// ---------- free questions (§18): GET /api/activity/questions (parent, unlocked) ----------
export type FreeQuestionOutcome = 'answered' | 'blocked' | 'adult_redirect' | 'unavailable';
export interface FreeQuestionLogEntry {
  id: Id; childId: Id; question: string; outcome: FreeQuestionOutcome;
  answer: string | null;            // only for `answered`
  createdAt: Millis;
}
export interface FreeQuestionHistory { entries: FreeQuestionLogEntry[] }

// ---------- external worker (§17): GET /api/settings/worker ----------
/** §21 window of the subscription the last figure is about. */
export type SubscriptionWindow = 'session' | 'week' | 'other';
export interface SubscriptionUsage {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  window: SubscriptionWindow | null;
  utilization: number | null;     // % of the window used (null: below the level the service reports)
  resetsAt: Millis | null;
  observedAt: Millis | null;      // when the home computer saw it (end of its last request)
}
export interface WorkerStatus {
  configured: boolean;            // worker token configured on the server
  connected: boolean;             // heartbeat seen in the last 90 s
  lastSeenAt: Millis | null;
  limited: boolean;               // usage limit reached on the worker side
  limitResetsAt: Millis | null;
  queued: { ai: number; pageText: number; pageSpeech: number /* §22 pages waiting for « Préparer la lecture » */ };
  /** §21: last use of the subscription reported by the home computer. */
  usage: SubscriptionUsage | null;
  /** §21: estimated cost this month (UTC) at list prices; allAccountsEur only for the owner account. */
  estimate: { monthToDateEur: number; allAccountsEur: number | null };
}

// ---------- §24 texts corrected with « Corriger »: GET /api/activity/writing (parent, unlocked) ----------
export interface WritingCorrectionEntry {
  id: Id; childId: Id; documentId: Id | null;
  originalText: string; correctedText: string; changes: WritingChange[];
  createdAt: Millis;
}
export interface WritingCorrectionHistory {
  entries: WritingCorrectionEntry[];                  // newest first
  /** Corrections of the child in the kept period (1 year), per kind. */
  counts: Record<WritingChangeKind, number>;
  /** The same mistake made at least twice (most frequent first): what to work on with the child. */
  frequent: { from: string; to: string; kind: WritingChangeKind; count: number }[];
}

// ---------- §22 « Préparer la lecture » ----------
/**
 * POST /api/documents/:id/reading-preparation. Without `pageIndexes` (whole document) or with more than 2 pages, the Réglages
 * must be unlocked; the reader asks for the page on screen. `force`: prepare again pages already prepared.
 */
export interface ReadingPreparationRequest { pageIndexes?: number[]; force?: boolean }
export type ReadingPreparationUnavailable = 'not_configured' | 'ai_disabled' | 'text_not_synced';
export interface ReadingPreparationResponse { queued: number; unavailable: ReadingPreparationUnavailable | null }

// ---------- §17.10 text written by a child ----------
/** PUT /api/documents/:id/text-mode (parent area unlocked). */
export interface DocumentTextModeRequest { textMode: DocumentTextMode }
/** The saved document and the number of pages sent to the « lecture intelligente » again in the new mode. */
export interface DocumentTextModeResponse { document: DocumentMeta; queued: number }

export interface OkResponse { ok: true }
export interface HealthStatus { ok: true; db: boolean; ai: { light: boolean; complex: boolean }; ocr: { available: boolean; busy: boolean } }
