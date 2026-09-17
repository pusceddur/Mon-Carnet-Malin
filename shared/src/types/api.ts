import type { AIOperation, AIRoute } from './ai';
import type { Annotation } from './annotations';
import type {
  ChildProfile, DocumentMeta, Id, Millis, PageContent, PageWarning, ParentUser, ReadingProgress, ReadingSession, TextBlock,
} from './domain';
import type { Answer, Exercise } from './exercises';

export interface ApiErrorBody { error: { code: string; message: string /* French */ } }
export interface AuthStatus {
  setupRequired: boolean; authenticated: boolean; parent: ParentUser | null; parentUnlockedUntil: Millis | null; pinSet: boolean;
  pinLockedUntil: Millis | null;   // §15.8: PIN attempts locked until this time
  registrationOpen: boolean;       // accounts can be created with an invitation code
}

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
  budget: { monthToDateEur: number; monthlyBudgetEur: number };
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

// ---------- external worker (§17): GET /api/settings/worker ----------
export interface WorkerStatus {
  configured: boolean;            // worker token configured on the server
  connected: boolean;             // heartbeat seen in the last 90 s
  lastSeenAt: Millis | null;
  limited: boolean;               // usage limit reached on the worker side
  limitResetsAt: Millis | null;
  queued: { ai: number; pageText: number };
}

export interface OkResponse { ok: true }
export interface HealthStatus { ok: true; db: boolean; ai: { light: boolean; complex: boolean }; ocr: { available: boolean; busy: boolean } }
