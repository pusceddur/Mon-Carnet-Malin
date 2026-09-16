import type { AIOperation, AIRoute } from './ai';
import type { Annotation } from './annotations';
import type {
  ChildProfile, DocumentMeta, Id, Millis, PageContent, PageWarning, ParentUser, ReadingProgress, ReadingSession, TextBlock,
} from './domain';
import type { Answer, Exercise } from './exercises';

export interface ApiErrorBody { error: { code: string; message: string /* French */ } }
export interface AuthStatus { setupRequired: boolean; authenticated: boolean; parent: ParentUser | null; parentUnlockedUntil: Millis | null; pinSet: boolean }
export interface SyncChanges {
  documents: DocumentMeta[]; pages: PageContent[]; annotations: Annotation[]; progress: ReadingProgress[];
  sessions: ReadingSession[]; exercises: Exercise[]; answers: Answer[]; children: ChildProfile[];
}
export interface SyncRequest { since: Millis; deviceId: string; changes: SyncChanges }
export interface SyncResponse { serverTime: Millis; changes: SyncChanges }
export interface OcrServerResult { blocks: TextBlock[]; confidence: number; engine: 'tesseract-best' }
export interface ActivitySummary {
  sessions: ReadingSession[];
  aiRequests: { id: Id; createdAt: Millis; childId: Id | null; operation: AIOperation; route: AIRoute; provider: string; model: string;
                status: string; rejectionReason: string | null; cacheHit: boolean; durationMs: number }[];
  alerts: { id: Id; createdAt: Millis; childId: Id | null; kind: 'adult_redirect' | 'safety_input' | 'safety_output' | 'injection_detected'; detail: string }[];
  ocrIssues: { documentId: Id; pageIndex: number; confidence: number | null; warnings: PageWarning[] }[];
}

// ---------- additions (foundations) ----------
export type SyncTable = keyof SyncChanges;
export type SyncEntity<T extends SyncTable> = SyncChanges[T][number];
export interface OkResponse { ok: true }
export interface HealthStatus { ok: true; db: boolean; ai: { light: boolean; complex: boolean } }
export type HandwritingResult =
  | { status: 'ok'; text: string }
  | { status: 'unavailable' | 'blocked'; message: string };
