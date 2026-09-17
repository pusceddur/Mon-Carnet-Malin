// Upload queue for original files (privacy.uploadOriginals) and processed page images (privacy.uploadPageImages).
// Entries only reference Dexie records (no blobs) and live in kv `pendingUploads` (contract §15.6).
import { LIMITS, type Id, type Millis, type ParentSettings } from '@aide/shared';
import { uploadDocumentFile, uploadPageImage } from '../api/documents';
import { ApiError } from '../api/http';
import { db } from '../db/localDb';
import { decodeToRgba, encodeRgbaJpeg } from '../ocr/preprocess/canvas';
import { isOnline } from '../platform/online';
import { subscribeSync } from '../sync/SyncEngine';
import { getDocument, getDocumentFile, getPageImage, getParentSettings } from './DocumentCache';
import { detectFileKind } from './DocumentParser';

export const PENDING_UPLOADS_KEY = 'pendingUploads';
const MAX_ATTEMPTS = 12;
const ORIGINAL_IMAGE_MAX_SIDE = 4096;

export interface PendingUpload {
  kind: 'original' | 'pageImage';
  documentId: Id;
  /** File index (original) or page index (page image). */
  index: number;
  attempts: number;
  nextAttemptAt: Millis;
}

const sameTarget = (a: Pick<PendingUpload, 'kind' | 'documentId' | 'index'>, b: Pick<PendingUpload, 'kind' | 'documentId' | 'index'>): boolean =>
  a.kind === b.kind && a.documentId === b.documentId && a.index === b.index;

function isPendingUpload(value: unknown): value is PendingUpload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<PendingUpload>;
  return (v.kind === 'original' || v.kind === 'pageImage') && typeof v.documentId === 'string' && typeof v.index === 'number'
    && typeof v.attempts === 'number' && typeof v.nextAttemptAt === 'number';
}

export async function readPendingUploads(): Promise<PendingUpload[]> {
  const record = await db.kv.get(PENDING_UPLOADS_KEY);
  return Array.isArray(record?.value) ? record.value.filter(isPendingUpload) : [];
}

async function mutate(fn: (list: PendingUpload[]) => PendingUpload[]): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const record = await db.kv.get(PENDING_UPLOADS_KEY);
    const list = Array.isArray(record?.value) ? record.value.filter(isPendingUpload) : [];
    await db.kv.put({ key: PENDING_UPLOADS_KEY, value: fn(list) });
  });
}

export async function enqueueUpload(kind: PendingUpload['kind'], documentId: Id, index: number, now = Date.now()): Promise<void> {
  await mutate((list) => [
    ...list.filter((e) => !sameTarget(e, { kind, documentId, index })),
    { kind, documentId, index, attempts: 0, nextAttemptAt: now },
  ]);
  scheduleFlush();
}

export async function forgetUploads(documentId: Id): Promise<void> {
  await mutate((list) => list.filter((e) => e.documentId !== documentId));
}

export function backoffMs(attempts: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

type UploadResult = 'done' | 'drop' | 'retry' | 'wait_sync';

async function uploadOne(entry: PendingUpload, settings: ParentSettings): Promise<UploadResult> {
  const doc = await getDocument(entry.documentId);
  if (!doc || doc.deletedAt !== null) return 'drop';
  if (entry.kind === 'pageImage') {
    if (!settings.privacy.uploadPageImages) return 'drop';
    const image = await getPageImage(entry.documentId, entry.index, 'ocr');
    if (!image || image.blob.size > LIMITS.pageImageMaxBytes) return 'drop';
    await uploadPageImage(entry.documentId, entry.index, image.blob);
    return 'done';
  }
  if (!settings.privacy.uploadOriginals) return 'drop';
  const file = await getDocumentFile(entry.documentId, entry.index);
  if (!file) return 'drop';
  let blob: Blob = file.blob;
  let name = `${entry.index}.pdf`;
  if (detectFileKind({ type: file.mime, name: file.name }) === 'image') {
    // Re-encode: no EXIF / GPS leaves the device.
    blob = await encodeRgbaJpeg(await decodeToRgba(file.blob, ORIGINAL_IMAGE_MAX_SIDE), 0.9);
    name = `${entry.index}.jpg`;
  }
  if (blob.size > LIMITS.documentFileMaxBytes) return 'drop';
  await uploadDocumentFile(entry.documentId, entry.index, blob, name);
  return 'done';
}

function classifyError(error: unknown): UploadResult {
  if (error instanceof ApiError) {
    if (error.code === 'document_not_synced') return 'wait_sync';
    if (error.status === 413 || error.status === 400 || error.status === 403 || error.status === 415) return 'drop';
  }
  return 'retry';
}

let flushing: Promise<void> | null = null;

/** Uploads due entries one at a time. Never throws. */
export function flushPendingUploads(now: () => number = Date.now): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      if (!isOnline()) return;
      const settings = await getParentSettings();
      const due = (await readPendingUploads()).filter((e) => e.nextAttemptAt <= now());
      for (const entry of due) {
        if (!isOnline()) break;
        let result: UploadResult;
        try {
          result = await uploadOne(entry, settings);
        } catch (error) {
          result = classifyError(error);
        }
        await mutate((list) =>
          list.flatMap((e) => {
            if (!sameTarget(e, entry)) return [e];
            if (result === 'done' || result === 'drop') return [];
            const attempts = e.attempts + 1;
            if (result === 'retry' && attempts >= MAX_ATTEMPTS) return [];
            const delay = result === 'wait_sync' ? 60_000 : backoffMs(attempts);
            return [{ ...e, attempts: result === 'wait_sync' ? e.attempts : attempts, nextAttemptAt: now() + delay }];
          }),
        );
      }
    } catch {
      // Storage errors: try again on the next trigger.
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(delayMs = 1_000): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushPendingUploads();
  }, delayMs);
}

let started = false;

/** Flushes on `online`, after each successful sync and every 2 minutes. Idempotent. */
export function startPendingUploads(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => scheduleFlush());
  let lastSyncAt: number | null = null;
  subscribeSync((status) => {
    if (status.lastSyncAt !== null && status.lastSyncAt !== lastSyncAt) {
      lastSyncAt = status.lastSyncAt;
      scheduleFlush();
    }
  });
  setInterval(() => scheduleFlush(0), 120_000);
  scheduleFlush(5_000);
}
