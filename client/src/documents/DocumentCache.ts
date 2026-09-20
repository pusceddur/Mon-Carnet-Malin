// Dexie helpers for documents, pages, page images, original files and processing jobs.
import {
  DEFAULT_PARENT_SETTINGS,
  ParentSettingsSchema,
  type DocumentMeta,
  type DocumentStatus,
  type DocumentPurpose,
  type DocumentTextMode,
  type Id,
  type PageContent,
  type ParentSettings,
} from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { fetchPageImage } from '../api/documents';
import { db, type DocumentFileRecord, type JobRecord, type PageImageRecord } from '../db/localDb';
import type { QuarterTurn } from '../ocr/preprocess/geometry';
import { useSessionStore } from '../state/session';
import { saveEntity } from '../sync/SyncEngine';

// ---------- jobs ----------

export interface PageSourceRef {
  /** documentFiles index. */
  fileIndex: number;
  /** 0-based page inside a PDF file, null for an image file. */
  pdfPageIndex: number | null;
}

export type JobStage = 'initial' | 'reprocess' | 'server_retry';

/** JobRecord (contract §10) plus the fields the queue needs; Dexie stores the extra properties as is. */
export interface QueueJob extends JobRecord {
  stage: JobStage;
  source: PageSourceRef | null;
  rotateDegrees: QuarterTurn;
  quad: [number, number][] | null;
  /** 'local': « Lire sur cet appareil » (§25). */
  mode: 'auto' | 'local';
  /** Higher runs first (explicit reprocessing). */
  priority: number;
  enqueuedAt: number;
  /** Deferred job: not before this time. */
  notBefore: number;
  serverRetries: number;
}

export function newJob(documentId: Id, pageIndex: number, source: PageSourceRef | null, now: number): QueueJob {
  return {
    documentId,
    pageIndex,
    state: 'queued',
    stage: 'initial',
    attempts: 0,
    error: null,
    updatedAt: now,
    source,
    rotateDegrees: 0,
    quad: null,
    mode: 'auto',
    priority: 0,
    enqueuedAt: now,
    notBefore: 0,
    serverRetries: 0,
  };
}

const QUARTER_TURNS: ReadonlySet<number> = new Set([0, 90, 180, 270]);

/** Reads a job record written by any version of the queue, filling missing fields. */
export function toQueueJob(record: JobRecord): QueueJob {
  const r = record as Partial<QueueJob> & JobRecord;
  const stage: JobStage = r.stage === 'reprocess' || r.stage === 'server_retry' ? r.stage : 'initial';
  const source =
    r.source && typeof r.source.fileIndex === 'number'
      ? { fileIndex: r.source.fileIndex, pdfPageIndex: typeof r.source.pdfPageIndex === 'number' ? r.source.pdfPageIndex : null }
      : null;
  const quad =
    Array.isArray(r.quad) && r.quad.length === 4 && r.quad.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n)))
      ? r.quad.map((p) => [p[0], p[1]] as [number, number])
      : null;
  return {
    documentId: r.documentId,
    pageIndex: r.pageIndex,
    state: r.state,
    stage,
    attempts: typeof r.attempts === 'number' ? r.attempts : 0,
    error: r.error ?? null,
    updatedAt: r.updatedAt,
    source,
    rotateDegrees: QUARTER_TURNS.has(r.rotateDegrees ?? 0) ? ((r.rotateDegrees ?? 0) as QuarterTurn) : 0,
    quad,
    // 'server' (reading on the server, removed on 2026-09-19) becomes a normal reading.
    mode: r.mode === 'local' ? 'local' : 'auto',
    priority: typeof r.priority === 'number' ? r.priority : 0,
    enqueuedAt: typeof r.enqueuedAt === 'number' ? r.enqueuedAt : r.updatedAt,
    notBefore: typeof r.notBefore === 'number' ? r.notBefore : 0,
    serverRetries: typeof r.serverRetries === 'number' ? r.serverRetries : 0,
  };
}

export async function getJob(documentId: Id, pageIndex: number): Promise<QueueJob | undefined> {
  const record = await db.jobs.get([documentId, pageIndex]);
  return record ? toQueueJob(record) : undefined;
}

export async function putJob(job: QueueJob): Promise<void> {
  await db.jobs.put(job);
}

// ---------- documents and pages ----------

export async function getDocument(id: Id): Promise<DocumentMeta | undefined> {
  return db.documents.get(id);
}

/** §19.3 purpose; copies saved on the device before homework existed have none and are for reading. */
export function documentPurpose(doc: Pick<DocumentMeta, 'purpose'>): DocumentPurpose {
  return (doc.purpose as DocumentPurpose | undefined) === 'homework' ? 'homework' : 'reading';
}

/** §17.10 text mode; copies saved on the device before text modes existed have none and are faithful. */
export function documentTextMode(doc: Pick<DocumentMeta, 'textMode'>): DocumentTextMode {
  return (doc.textMode as DocumentTextMode | undefined) === 'punctuated' ? 'punctuated' : 'faithful';
}

export async function saveDocument(doc: DocumentMeta): Promise<void> {
  await saveEntity('documents', doc);
}

export async function getPage(documentId: Id, pageIndex: number): Promise<PageContent | undefined> {
  return db.pages.get([documentId, pageIndex]);
}

export async function getPages(documentId: Id): Promise<PageContent[]> {
  const pages = await db.pages.where('documentId').equals(documentId).toArray();
  return pages.sort((a, b) => a.pageIndex - b.pageIndex);
}

export async function savePage(page: PageContent): Promise<void> {
  await saveEntity('pages', page);
}

/** processing while a page waits; partial when a page failed or is doubtful; ready otherwise. */
export function deriveDocumentStatus(pages: readonly Pick<PageContent, 'status'>[]): DocumentStatus {
  if (pages.some((p) => p.status === 'pending' || p.status === 'processing')) return 'processing';
  if (pages.some((p) => p.status === 'failed' || p.status === 'low_confidence')) return 'partial';
  return 'ready';
}

/** Recomputes and saves the document status when it changed. */
export async function refreshDocumentStatus(documentId: Id, now = Date.now()): Promise<DocumentMeta | undefined> {
  const doc = await getDocument(documentId);
  if (!doc || doc.deletedAt !== null) return doc;
  const pages = await getPages(documentId);
  if (pages.length === 0) return doc;
  const status = deriveDocumentStatus(pages);
  if (status === doc.status) return doc;
  const updated: DocumentMeta = { ...doc, status, updatedAt: Math.max(now, doc.updatedAt + 1) };
  await saveDocument(updated);
  return updated;
}

// ---------- files and images ----------

export async function getDocumentFiles(documentId: Id): Promise<DocumentFileRecord[]> {
  const files = await db.documentFiles.where('documentId').equals(documentId).toArray();
  return files.sort((a, b) => a.index - b.index);
}

export async function getDocumentFile(documentId: Id, index: number): Promise<DocumentFileRecord | undefined> {
  return db.documentFiles.get([documentId, index]);
}

export async function getPageImage(documentId: Id, pageIndex: number, variant: PageImageRecord['variant']): Promise<PageImageRecord | undefined> {
  return db.pageImages.get([documentId, pageIndex, variant]);
}

export async function putPageImages(records: PageImageRecord[]): Promise<void> {
  await db.pageImages.bulkPut(records);
}

/** Processed page image: local copy, else the server copy (cached locally). Null when absent everywhere. */
export async function loadProcessedPageImage(documentId: Id, pageIndex: number): Promise<Blob | null> {
  const local = await getPageImage(documentId, pageIndex, 'ocr');
  if (local) return local.blob;
  const remote = await fetchPageImage(documentId, pageIndex);
  if (!remote) return null;
  try {
    const page = await getPage(documentId, pageIndex);
    await db.pageImages.put({
      documentId,
      pageIndex,
      variant: 'ocr',
      blob: remote,
      width: page?.width ?? 0,
      height: page?.height ?? 0,
    });
  } catch {
    // Cache failure (quota) is not fatal.
  }
  return remote;
}

/** Removes every local trace of a document except its (synced) meta: pages, images, files, jobs. */
export async function purgeDocumentLocalData(documentId: Id): Promise<void> {
  await db.transaction('rw', [db.pages, db.pageImages, db.documentFiles, db.jobs], async () => {
    await db.pages.where('documentId').equals(documentId).delete();
    await db.pageImages.where('documentId').equals(documentId).delete();
    await db.documentFiles.where('documentId').equals(documentId).delete();
    await db.jobs.where('documentId').equals(documentId).delete();
  });
}

// ---------- settings and owner ----------

/** Session store, else cached kv copy, else defaults. */
export async function getParentSettings(): Promise<ParentSettings> {
  const fromStore = useSessionStore.getState().parentSettings;
  if (fromStore) return fromStore;
  try {
    const record = await db.kv.get('parentSettings');
    const parsed = ParentSettingsSchema.safeParse(record?.value);
    if (parsed.success) return parsed.data as ParentSettings;
  } catch {
    // Fall back to defaults.
  }
  return DEFAULT_PARENT_SETTINGS;
}

export async function getOwnerParentId(): Promise<Id> {
  const fromStore = useSessionStore.getState().authStatus?.parent?.id;
  if (fromStore) return fromStore;
  try {
    const record = await db.kv.get('authStatus');
    const value = record?.value as { parent?: { id?: unknown } | null } | undefined;
    if (value && value.parent && typeof value.parent.id === 'string') return value.parent.id;
  } catch {
    // Unknown owner: the server assigns the session parent on sync.
  }
  return '';
}

// ---------- React hooks ----------

/** Object URL of a stored page image variant; revoked automatically. */
export function usePageImageUrl(documentId: Id | undefined, pageIndex: number, variant: PageImageRecord['variant']): string | null {
  const blob = useLiveQuery(
    async () => (documentId ? ((await getPageImage(documentId, pageIndex, variant))?.blob ?? null) : null),
    [documentId, pageIndex, variant],
    null,
  );
  return useObjectUrl(blob);
}

export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob]);
  return url;
}
