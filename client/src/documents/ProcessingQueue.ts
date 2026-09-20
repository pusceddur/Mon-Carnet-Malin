// Progressive page processing (contract §7, §11.2, §15.6): one page at a time, persisted jobs, crash-loop guard,
// resume after reload, reprocessing from the parent editor. §25 (2026-09-19): when the home computer reads the pages
// (« lecture intelligente »), every photo / scanned page is handed over to it and the device does no reading; the reading
// on the device (local OCR with quality checks) is only used without the home computer or on explicit request. PDF text
// layers and EPUB text are always taken as they are. No reading on the server any more.
import {
  DEFAULT_PARENT_SETTINGS, type Id, type PageContent, type PageStatus, type PageTextSource, type PageWarning, type ParentSettings, type TextBlock,
  type WordList,
} from '@aide/shared';
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { db, type PageImageRecord } from '../db/localDb';
import { browserOcr, OcrUnavailableError, type OcrEngine } from '../ocr/BrowserOCR';
import { canDecodeImage } from '../ocr/preprocess/canvas';
import {
  binarizeImage,
  FALLBACK_PAGE_SIDE,
  prepareFallbackPage,
  preparePage,
  PreprocessAbortedError,
  rotationProbeImages,
  terminatePreprocessWorker,
  type PreparedPage,
} from '../ocr/preprocess/client';
import type { QuarterTurn } from '../ocr/preprocess/geometry';
import type { GrayImage, Rect, RgbaImage } from '../ocr/preprocess/image';
import { MAX_PAGE_SIDE, THUMB_SIDE, type PreprocessOptions } from '../ocr/preprocess/pipeline';
import type { ProbeTurn } from '../ocr/preprocess/protocol';
import { qualityFromOcrLines } from '../ocr/quality';
import { recognizePage } from '../ocr/readPage';
import { loadFrenchWordList } from '../ocr/wordList';
import { reportProblem } from '../platform/diagnostics';
import { isOnline } from '../platform/online';
import { requestWakeLock } from '../platform/support';
import { useSessionStore } from '../state/session';
import { watchAiReading } from './aiReadingWatch';
import {
  getDocument,
  getDocumentFile,
  getDocumentFiles,
  getJob,
  getPage,
  getParentSettings,
  loadProcessedPageImage,
  newJob,
  putJob,
  putPageImages,
  refreshDocumentStatus,
  savePage,
  toQueueJob,
  type QueueJob,
} from './DocumentCache';
import {
  AVAILABLE_STATUSES,
  blocksFromLayoutLines,
  blocksFromOcrLines,
  cleanBlocks,
  computeContentHash,
  detectFileKind,
  hasUsablePdfText,
  pendingPage,
} from './DocumentParser';
import { openPdf, type PdfHandle } from './PDFReader';
import { enqueueUpload, startPendingUploads } from './pendingUploads';

export interface DocumentProgress { documentId: Id; total: number; ready: number; lowConfidence: number; failed: number; processingPageIndex: number | null; percent: number }

/** `onDevice`: « Lire sur cet appareil », the device reads the page even when the home computer could. */
export interface ReprocessOptions { onDevice?: boolean; rotateDegrees?: 0 | 90 | 180 | 270; quad?: [number, number][] }

export type ProcessingErrorCode =
  | 'source_missing'
  | 'ocr_unavailable'
  | 'image_decode_failed'
  | 'unsupported_file'
  | 'crash_loop'
  | 'cancelled'
  | 'failed';

export class ProcessingError extends Error {
  readonly code: ProcessingErrorCode;
  /** No automatic retry. */
  readonly permanent: boolean;
  /** The request failed but the page keeps its current content. */
  readonly keepPage: boolean;

  constructor(code: ProcessingErrorCode, options: { permanent?: boolean; keepPage?: boolean } = {}) {
    super(code);
    this.name = 'ProcessingError';
    this.code = code;
    this.permanent = options.permanent ?? false;
    this.keepPage = options.keepPage ?? false;
  }
}

export const MAX_JOB_ATTEMPTS = 2;
const REPROCESS_PRIORITY = 10;

export interface QueueDeps {
  ocr: OcrEngine;
  /** §25: the server has a home computer that reads the page images (AuthStatus.aiReading). */
  aiReading(): boolean;
  /** §25: the page waits for its text from the home computer (the app asks for news more often meanwhile). */
  watchAiReading(documentId: Id, pageIndex: number): void;
  openPdf(blob: Blob): Promise<PdfHandle>;
  preparePage(source: Blob | RgbaImage, options: PreprocessOptions): Promise<PreparedPage>;
  /** Smaller, main-thread preparation used when preparePage failed. */
  prepareFallback(source: Blob | RgbaImage, options: PreprocessOptions): Promise<PreparedPage>;
  binarize(image: GrayImage): Promise<GrayImage>;
  rotationProbes(image: GrayImage, turns: ProbeTurn[]): Promise<{ turn: ProbeTurn; image: GrayImage }[]>;
  loadWordList(): Promise<WordList | null>;
  getSettings(): Promise<ParentSettings>;
  isOnline(): boolean;
  /** pencil: re-anchors text annotations against the new page content, before it is saved (§15.7). */
  reanchor(documentId: Id, pageIndex: number, page: PageContent): Promise<void>;
  enqueueUpload(kind: 'original' | 'pageImage', documentId: Id, index: number): Promise<void>;
  canDecodeImage(blob: Blob): Promise<boolean>;
  loadProcessedImage(documentId: Id, pageIndex: number): Promise<Blob | null>;
  requestWakeLock(): Promise<() => void>;
  /** Stops helper workers (pagehide). */
  terminateHelpers(): void;
  now(): number;
}

function defaultDeps(): QueueDeps {
  return {
    ocr: browserOcr,
    aiReading: () => useSessionStore.getState().authStatus?.aiReading === true,
    watchAiReading,
    openPdf: (blob) => openPdf(blob),
    preparePage,
    prepareFallback: prepareFallbackPage,
    binarize: binarizeImage,
    rotationProbes: (image, turns) => rotationProbeImages(image, turns),
    loadWordList: () => loadFrenchWordList(),
    getSettings: getParentSettings,
    isOnline,
    reanchor: async (documentId, pageIndex, page) => {
      const pencil = await import('../pencil');
      await pencil.reanchorPageAnnotations(documentId, pageIndex, page);
    },
    enqueueUpload: (kind, documentId, index) => enqueueUpload(kind, documentId, index),
    canDecodeImage,
    loadProcessedImage: loadProcessedPageImage,
    requestWakeLock: () => requestWakeLock(),
    terminateHelpers: terminatePreprocessWorker,
    now: () => Date.now(),
  };
}

interface Candidate {
  blocks: TextBlock[];
  score: number;
  source: Extract<PageTextSource, 'ocr-local'>;
}

type JobOutcome = { kind: 'done' } | { kind: 'removed' };

type ResolvedSource =
  | { kind: 'pdf'; blob: Blob; pdfPageIndex: number; fileKey: string }
  | { kind: 'image'; blob: Blob }
  | { kind: 'processed'; blob: Blob };

class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortedError';
  }
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new AbortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new AbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

const waiterKey = (documentId: Id, pageIndex: number, generation: number): string => `${documentId}:${pageIndex}:${generation}`;

export function computeProgress(documentId: Id, pages: readonly Pick<PageContent, 'status' | 'pageIndex'>[], processingPageIndex: number | null): DocumentProgress {
  let ready = 0;
  let lowConfidence = 0;
  let failed = 0;
  for (const p of pages) {
    if (p.status === 'ready') ready++;
    else if (p.status === 'low_confidence') lowConfidence++;
    else if (p.status === 'failed') failed++;
  }
  const total = pages.length;
  const done = ready + lowConfidence + failed;
  const percent = total === 0 ? 0 : Math.round((100 * done) / total);
  return { documentId, total, ready, lowConfidence, failed, processingPageIndex, percent };
}

export class ProcessingQueue {
  private readonly deps: QueueDeps;
  private recovery: Promise<void> | null = null;
  private loop: Promise<void> | null = null;
  private dirty = false;
  private stopped = false;
  private current: { documentId: Id; pageIndex: number; abort: AbortController } | null = null;
  private readonly listeners = new Set<(documentId: Id) => void>();
  private readonly waiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }[]>();
  private deferredTimer: ReturnType<typeof setTimeout> | null = null;
  private pdf: { key: string; handle: PdfHandle } | null = null;
  private lifecycleInstalled = false;
  /** Step of the running job, reported with failures (device-only problems). */
  private currentStage: string | null = null;

  constructor(deps: Partial<QueueDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  // ---------- public API ----------

  /** Resumes persisted jobs (also after a reload). Idempotent. */
  start(): void {
    this.stopped = false;
    this.installLifecycle();
    this.kick();
  }

  subscribe(documentId: Id, cb: (p: DocumentProgress) => void): () => void {
    let pages: PageContent[] | null = null;
    const push = (): void => {
      if (pages) cb(computeProgress(documentId, pages, this.processingPageIndex(documentId)));
    };
    const subscription = liveQuery(() => db.pages.where('documentId').equals(documentId).toArray()).subscribe({
      next: (value) => {
        pages = value;
        push();
      },
      error: () => undefined,
    });
    const listener = (id: Id): void => {
      if (id === documentId) push();
    };
    this.listeners.add(listener);
    return () => {
      subscription.unsubscribe();
      this.listeners.delete(listener);
    };
  }

  async reprocessPage(documentId: Id, pageIndex: number, opts: ReprocessOptions = {}): Promise<void> {
    await this.recover();
    const doc = await getDocument(documentId);
    if (!doc || doc.deletedAt !== null) throw new ProcessingError('source_missing', { permanent: true });
    const existing = await getJob(documentId, pageIndex);
    const now = this.deps.now();
    const job = existing ?? newJob(documentId, pageIndex, null, now);
    if (opts.rotateDegrees !== undefined) job.rotateDegrees = opts.rotateDegrees;
    if (opts.quad !== undefined) job.quad = validQuad(opts.quad);
    job.mode = opts.onDevice ? 'local' : 'auto';
    return this.enqueueExplicit(job, now);
  }

  /** « Reprendre la photo »: the new image becomes the page source, then the page is processed again. */
  async replacePageImage(documentId: Id, pageIndex: number, file: File): Promise<void> {
    await this.recover();
    const doc = await getDocument(documentId);
    if (!doc || doc.deletedAt !== null) throw new ProcessingError('source_missing', { permanent: true });
    if (detectFileKind(file) !== 'image') throw new ProcessingError('unsupported_file', { permanent: true });
    if (!(await this.deps.canDecodeImage(file))) throw new ProcessingError('image_decode_failed', { permanent: true });
    const files = await getDocumentFiles(documentId);
    const index = files.reduce((max, f) => Math.max(max, f.index), -1) + 1;
    await db.documentFiles.put({
      documentId,
      index,
      name: file.name || `photo-${index + 1}.jpg`,
      mime: file.type || 'image/jpeg',
      size: file.size,
      blob: file,
    });
    const settings = await this.deps.getSettings();
    if (settings.privacy.uploadOriginals) await this.deps.enqueueUpload('original', documentId, index);
    const now = this.deps.now();
    const job = (await getJob(documentId, pageIndex)) ?? newJob(documentId, pageIndex, null, now);
    job.source = { fileIndex: index, pdfPageIndex: null };
    job.rotateDegrees = 0;
    job.quad = null;
    job.mode = 'auto';
    return this.enqueueExplicit(job, now);
  }

  /** Manual text correction from the parent editor (textSource manual + warning manually_corrected). */
  async savePageCorrection(documentId: Id, pageIndex: number, blocks: TextBlock[]): Promise<PageContent> {
    const prev = await getPage(documentId, pageIndex);
    if (!prev) throw new ProcessingError('source_missing', { permanent: true });
    const warnings: PageWarning[] = prev.warnings.filter(
      (w) => w !== 'low_confidence' && w !== 'no_text_found' && w !== 'manually_corrected',
    );
    warnings.push('manually_corrected');
    const cleaned = cleanBlocks(blocks);
    const page = await this.buildPage(prev, {
      status: 'ready',
      textSource: 'manual',
      blocks: cleaned,
      confidence: null,
      width: prev.width,
      height: prev.height,
      warnings: cleaned.length === 0 ? [...warnings, 'no_text_found'] : warnings,
    });
    await this.commitPage(prev, page);
    const job = await getJob(documentId, pageIndex);
    if (job && job.state === 'queued') {
      job.state = 'done';
      job.error = null;
      job.updatedAt = this.deps.now();
      await putJob(job);
    }
    await refreshDocumentStatus(documentId, this.deps.now());
    this.emit(documentId);
    return page;
  }

  /** Stops the processing of a document (deletion) and removes its jobs. */
  async cancelDocument(documentId: Id): Promise<void> {
    if (this.current?.documentId === documentId) this.current.abort.abort();
    if (this.pdf?.key.startsWith(`${documentId}:`)) await this.closePdf();
    await db.jobs.where('documentId').equals(documentId).delete();
    for (const [key, list] of this.waiters) {
      if (!key.startsWith(`${documentId}:`)) continue;
      this.waiters.delete(key);
      for (const w of list) w.reject(new ProcessingError('cancelled', { permanent: true }));
    }
    this.emit(documentId);
  }

  processingPageIndex(documentId: Id): number | null {
    return this.current?.documentId === documentId ? this.current.pageIndex : null;
  }

  /** Resolves when no job is running (tests, diagnostics). */
  async whenIdle(): Promise<void> {
    while (this.loop) await this.loop;
  }

  /** Stops processing (tests). Jobs stay persisted. */
  stop(): void {
    this.stopped = true;
    this.current?.abort.abort();
    if (this.deferredTimer !== null) clearTimeout(this.deferredTimer);
    this.deferredTimer = null;
  }

  // ---------- loop ----------

  kick(): void {
    this.dirty = true;
    if (this.loop || this.stopped) return;
    this.loop = this.runLoop()
      .catch(() => undefined)
      .finally(() => {
        this.loop = null;
        if (this.dirty && !this.stopped) this.kick();
      });
  }

  private async runLoop(): Promise<void> {
    await this.recover();
    let releaseWakeLock: (() => void) | null = null;
    try {
      while (!this.stopped) {
        this.dirty = false;
        const job = await this.pickNextJob();
        if (!job) {
          if (this.dirty) continue;
          await this.scheduleDeferred();
          break;
        }
        if (!releaseWakeLock) releaseWakeLock = await this.deps.requestWakeLock().catch(() => null);
        await this.runJob(job);
      }
    } finally {
      releaseWakeLock?.();
      await this.closePdf();
    }
  }

  private async pickNextJob(): Promise<QueueJob | null> {
    const now = this.deps.now();
    const queued = (await db.jobs.where('state').equals('queued').toArray()).map(toQueueJob);
    const due = queued.filter((j) => j.notBefore <= now);
    due.sort(
      (a, b) =>
        b.priority - a.priority ||
        a.enqueuedAt - b.enqueuedAt ||
        (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0) ||
        a.pageIndex - b.pageIndex,
    );
    return due[0] ?? null;
  }

  private async scheduleDeferred(): Promise<void> {
    if (this.deferredTimer !== null) clearTimeout(this.deferredTimer);
    this.deferredTimer = null;
    const now = this.deps.now();
    const later = (await db.jobs.where('state').equals('queued').toArray()).map(toQueueJob).filter((j) => j.notBefore > now);
    if (later.length === 0) return;
    const wait = Math.min(60 * 60_000, Math.min(...later.map((j) => j.notBefore)) - now);
    this.deferredTimer = setTimeout(() => {
      this.deferredTimer = null;
      this.kick();
    }, Math.max(1_000, wait));
  }

  private recover(): Promise<void> {
    if (!this.recovery) this.recovery = this.doRecover().catch(() => undefined);
    return this.recovery;
  }

  /** Crash-loop guard (§15.6): a job still « running » after a reload crashed the tab; the second time, the page fails. */
  private async doRecover(): Promise<void> {
    const now = this.deps.now();
    const running = (await db.jobs.where('state').equals('running').toArray()).map(toQueueJob);
    const touched = new Set<Id>();
    for (const job of running) {
      if (job.attempts >= MAX_JOB_ATTEMPTS) {
        job.state = 'error';
        job.error = 'crash_loop';
        job.updatedAt = now;
        await putJob(job);
        const page = await getPage(job.documentId, job.pageIndex);
        if (page && !AVAILABLE_STATUSES.has(page.status)) {
          await savePage({ ...page, status: 'failed', updatedAt: Math.max(now, page.updatedAt + 1) });
        }
        touched.add(job.documentId);
      } else {
        job.state = 'queued';
        job.updatedAt = now;
        await putJob(job);
      }
    }
    const documentIds = new Set((await db.jobs.toArray()).map((j) => j.documentId));
    for (const documentId of documentIds) {
      const doc = await getDocument(documentId);
      if (!doc || doc.deletedAt !== null) {
        await db.jobs.where('documentId').equals(documentId).delete();
        touched.delete(documentId);
      }
    }
    for (const documentId of touched) {
      await refreshDocumentStatus(documentId, now);
      this.emit(documentId);
    }
  }

  private async enqueueExplicit(job: QueueJob, now: number): Promise<void> {
    const generation = Math.max(now, job.enqueuedAt + 1);
    job.stage = 'reprocess';
    job.state = 'queued';
    job.attempts = 0;
    job.error = null;
    job.priority = REPROCESS_PRIORITY;
    job.enqueuedAt = generation;
    job.notBefore = 0;
    job.serverRetries = 0;
    job.updatedAt = now;
    const done = new Promise<void>((resolve, reject) => {
      const key = waiterKey(job.documentId, job.pageIndex, generation);
      const list = this.waiters.get(key) ?? [];
      list.push({ resolve, reject });
      this.waiters.set(key, list);
    });
    await putJob(job);
    this.kick();
    return done;
  }

  private settleWaiters(job: QueueJob, error: Error | null): void {
    const key = waiterKey(job.documentId, job.pageIndex, job.enqueuedAt);
    const list = this.waiters.get(key);
    if (!list) return;
    this.waiters.delete(key);
    for (const w of list) {
      if (error) w.reject(error);
      else w.resolve();
    }
  }

  /** Persists the job unless an explicit request replaced it while it was running. */
  private async putJobIfCurrent(job: QueueJob, generation: number): Promise<boolean> {
    const latest = await getJob(job.documentId, job.pageIndex);
    if (!latest || latest.enqueuedAt !== generation) return false;
    await putJob(job);
    return true;
  }

  private async runJob(job: QueueJob): Promise<void> {
    const generation = job.enqueuedAt;
    job.attempts += 1;
    job.state = 'running';
    job.updatedAt = this.deps.now();
    // Saved BEFORE running: if the tab crashes, the next start() sees it (§15.6).
    await putJob(job);
    const abort = new AbortController();
    this.current = { documentId: job.documentId, pageIndex: job.pageIndex, abort };
    this.emit(job.documentId);
    try {
      const outcome = await this.processJob(job, abort.signal);
      if (outcome.kind === 'removed') {
        await db.jobs.delete([job.documentId, job.pageIndex]);
        this.settleWaiters(job, new ProcessingError('cancelled', { permanent: true }));
        return;
      }
      const wasCurrent = await getJob(job.documentId, job.pageIndex);
      if (!wasCurrent || wasCurrent.enqueuedAt !== generation) {
        this.settleWaiters(job, null);
        return;
      }
      job.state = 'done';
      job.priority = 0;
      job.mode = 'auto';
      this.settleWaiters(job, null);
      job.attempts = 0;
      job.error = null;
      job.updatedAt = this.deps.now();
      await putJob(job);
    } catch (error) {
      if (abort.signal.aborted || error instanceof AbortedError || error instanceof PreprocessAbortedError) {
        // pagehide or cancellation: the attempt does not count.
        const stillThere = await getDocument(job.documentId).catch(() => undefined);
        if (stillThere && stillThere.deletedAt === null) {
          job.state = 'queued';
          job.attempts = Math.max(0, job.attempts - 1);
          job.updatedAt = this.deps.now();
          await this.putJobIfCurrent(job, generation).catch(() => false);
        }
        return;
      }
      await this.handleFailure(job, generation, error);
    } finally {
      this.current = null;
      this.currentStage = null;
      await refreshDocumentStatus(job.documentId, this.deps.now()).catch(() => undefined);
      this.emit(job.documentId);
    }
  }

  private async handleFailure(job: QueueJob, generation: number, error: unknown): Promise<void> {
    const failure =
      error instanceof ProcessingError
        ? error
        : error instanceof OcrUnavailableError
          ? new ProcessingError('ocr_unavailable')
          : new ProcessingError(error instanceof Error && error.name === 'ImageDecodeError' ? 'image_decode_failed' : 'failed');
    const now = this.deps.now();
    const finalFailure = !failure.keepPage && (failure.permanent || job.attempts >= MAX_JOB_ATTEMPTS);
    reportProblem('processing_failed', error, this.currentStage, {
      code: failure.code,
      attempts: job.attempts,
      final: finalFailure,
      pageIndex: job.pageIndex,
      mode: job.mode,
    });
    if (failure.keepPage) {
      job.state = 'done';
      job.priority = 0;
      job.mode = 'auto';
      job.attempts = 0;
      job.error = failure.code;
      job.updatedAt = now;
      await this.putJobIfCurrent(job, generation);
      this.settleWaiters(job, failure);
      return;
    }
    if (!failure.permanent && job.attempts < MAX_JOB_ATTEMPTS) {
      job.state = 'queued';
      job.error = failure.code;
      job.updatedAt = now;
      await this.putJobIfCurrent(job, generation);
      return;
    }
    job.state = 'error';
    job.error = failure.code;
    job.priority = 0;
    job.updatedAt = now;
    if (await this.putJobIfCurrent(job, generation)) {
      const page = await getPage(job.documentId, job.pageIndex);
      // A page that already has readable text keeps it; only pages without text become « failed ».
      if (page && !AVAILABLE_STATUSES.has(page.status)) {
        await savePage({ ...page, status: 'failed', updatedAt: Math.max(now, page.updatedAt + 1) });
      } else if (!page) {
        await savePage({ ...pendingPage(job.documentId, job.pageIndex, now), status: 'failed' });
      }
    }
    this.settleWaiters(job, failure);
  }

  // ---------- page processing ----------

  private async processJob(job: QueueJob, signal: AbortSignal): Promise<JobOutcome> {
    const { deps } = this;
    const doc = await getDocument(job.documentId);
    if (!doc || doc.deletedAt !== null) return { kind: 'removed' };
    const settings = await deps.getSettings();
    const prev = (await getPage(job.documentId, job.pageIndex)) ?? pendingPage(job.documentId, job.pageIndex, deps.now());

    // Already readable (processed on another device and synced): nothing to do.
    if (job.stage === 'initial' && AVAILABLE_STATUSES.has(prev.status) && prev.textSource !== null) return { kind: 'done' };
    // Later reading by the server, queued by an older version of the app: there is no reading on the server any more.
    if (job.stage === 'server_retry') return { kind: 'done' };

    this.currentStage = 'resolve_source';
    const source = await this.resolveSource(job);
    const threshold = settings.ocr.lowConfidenceThreshold;

    // 1. PDF with a text layer: no OCR.
    if (source.kind === 'pdf' && job.mode === 'auto' && job.rotateDegrees === 0 && !job.quad) {
      this.currentStage = 'pdf_open';
      const pdf = await withAbort(this.getPdf(source.fileKey, source.blob), signal);
      this.currentStage = 'pdf_text';
      const lines = await withAbort(pdf.getPageLines(source.pdfPageIndex), signal);
      if (hasUsablePdfText(lines)) {
        const page = await this.buildPage(prev, {
          status: 'ready',
          textSource: 'pdf-text',
          blocks: blocksFromLayoutLines(lines),
          confidence: null,
          width: prev.width,
          height: prev.height,
          warnings: [],
        });
        await this.commitPage(prev, page);
        await this.renderPdfImage(pdf, source.pdfPageIndex, page, settings, signal);
        return { kind: 'done' };
      }
    }

    // 2. Image path: render / decode → preprocess → OCR.
    const loadInput = async (): Promise<Blob | RgbaImage> =>
      source.kind === 'pdf'
        ? withAbort((await this.getPdf(source.fileKey, source.blob)).renderPage(source.pdfPageIndex, MAX_PAGE_SIDE), signal)
        : source.blob;
    const baseOptions: PreprocessOptions = {
      rotateDegrees: job.rotateDegrees,
      quad: job.quad,
      denoise: source.kind === 'image',
      crop: source.kind !== 'processed',
      deskew: true,
      minSide: source.kind === 'processed' ? 0 : undefined,
    };
    this.currentStage = source.kind === 'pdf' ? 'pdf_render' : 'decode';
    let prepared: PreparedPage;
    try {
      const input = await loadInput();
      this.currentStage = 'preprocess';
      prepared = await withAbort(deps.preparePage(input, baseOptions), signal);
    } catch (error) {
      if (signal.aborted || error instanceof AbortedError || error instanceof PreprocessAbortedError) throw error;
      // Usually memory on iPad with large photos / scans: retry smaller on the main thread instead of failing the page.
      reportProblem('preprocess', error, this.currentStage, { sourceKind: source.kind, pageIndex: job.pageIndex });
      this.currentStage = 'preprocess_fallback';
      const small: Blob | RgbaImage =
        source.kind === 'pdf'
          ? await withAbort((await this.getPdf(source.fileKey, source.blob)).renderPage(source.pdfPageIndex, FALLBACK_PAGE_SIDE), signal)
          : source.blob;
      prepared = await withAbort(deps.prepareFallback(small, baseOptions), signal);
    }
    // §25: the home computer reads the page (photos, scans, a child's handwriting and punctuation §17.10): no reading here.
    if (job.mode === 'auto' && this.aiReads(settings)) {
      await this.handOverToAi(job, prev, prepared, source);
      return { kind: 'done' };
    }
    this.currentStage = 'word_list';
    const wordList = await deps.loadWordList();

    // 3. Reading on the device (no home computer, or « Lire sur cet appareil »).
    let best: Candidate | null = null;
    let localUnavailable = false;
    this.currentStage = 'local_ocr';
    try {
      best = await this.localCandidate(prepared.image, prepared.regions, wordList, signal);
      if (best.score < threshold) {
        const binarized = await withAbort(deps.binarize(prepared.image), signal);
        const candidate = await this.localCandidate(binarized, prepared.regions, wordList, signal);
        if (candidate.score > best.score) best = candidate;
      }
      if (best.score < threshold && job.rotateDegrees === 0 && !job.quad && source.kind !== 'processed') {
        const turn = await this.findBetterRotation(prepared.image, best.score, threshold, wordList, signal);
        if (turn !== null) {
          const rotated = await withAbort(deps.preparePage(await loadInput(), { ...baseOptions, rotateDegrees: turn }), signal);
          const candidate = await this.localCandidate(rotated.image, rotated.regions, wordList, signal);
          if (candidate.score > best.score) {
            best = candidate;
            prepared = rotated;
            job.rotateDegrees = turn;
          }
        }
      }
    } catch (error) {
      if (signal.aborted || error instanceof AbortedError || error instanceof PreprocessAbortedError) throw error;
      if (!(error instanceof OcrUnavailableError)) reportProblem('ocr_engine', error, 'local_ocr', { pageIndex: job.pageIndex });
      localUnavailable = true;
    } finally {
      deps.ocr.notePageDone();
    }
    if (!best) {
      const code: ProcessingErrorCode = localUnavailable ? 'ocr_unavailable' : 'failed';
      // The device cannot read at all: the home computer reads the page when there is one (§17.7).
      if (this.aiReads(settings) && !AVAILABLE_STATUSES.has(prev.status)) {
        await this.awaitAiTranscription(job, prev, prepared, source, code);
        return { kind: 'done' };
      }
      throw new ProcessingError(code);
    }

    this.currentStage = 'store';
    await this.storeImages(job.documentId, job.pageIndex, prepared);
    if (source.kind === 'processed') {
      // The rotation / frame are now baked into the stored image.
      job.rotateDegrees = 0;
      job.quad = null;
    }
    const page = await this.buildPage(prev, this.pageFieldsFor(best, threshold, prepared));
    await this.commitPage(prev, page);
    if (settings.privacy.uploadPageImages) await deps.enqueueUpload('pageImage', job.documentId, job.pageIndex).catch(() => undefined);
    return { kind: 'done' };
  }

  /** §25: pages go to the home computer (« lecture intelligente » on, images and text synced, worker on the server). */
  private aiReads(settings: ParentSettings): boolean {
    return awaitsAiTranscription(settings) && this.deps.aiReading();
  }

  /**
   * Neither the device nor the server could read the page (§17.7): the page is handed over to the « lecture intelligente »
   * and the job ends here (no more local attempts, not resumed on the next start).
   */
  private async awaitAiTranscription(job: QueueJob, prev: PageContent, prepared: PreparedPage, source: ResolvedSource, code: ProcessingErrorCode): Promise<void> {
    reportProblem('processing_failed', new ProcessingError(code), this.currentStage, {
      code,
      attempts: job.attempts,
      final: true,
      pageIndex: job.pageIndex,
      mode: job.mode,
      awaitingAi: true,
    });
    await this.handOverToAi(job, prev, prepared, source);
  }

  /**
   * The processed image is kept and sent to the server, where the home computer transcribes it; the text then arrives with
   * the sync (§17.7). A page without text stays « failed » with the warning awaiting_ai (shown as waiting); a page that
   * already has text keeps it until then (§17.10, reprocessing of a child's text).
   */
  private async handOverToAi(job: QueueJob, prev: PageContent, prepared: PreparedPage, source: ResolvedSource): Promise<void> {
    this.currentStage = 'store';
    await this.storeImages(job.documentId, job.pageIndex, prepared);
    if (source.kind === 'processed') {
      job.rotateDegrees = 0;
      job.quad = null;
    }
    const { width, height } = prepared.image;
    if (AVAILABLE_STATUSES.has(prev.status) && prev.textSource !== null) {
      await savePage({ ...prev, width, height, updatedAt: Math.max(this.deps.now(), prev.updatedAt + 1) });
    } else {
      const page = await this.buildPage(prev, {
        status: 'failed',
        textSource: null,
        blocks: [],
        confidence: null,
        width,
        height,
        warnings: ['awaiting_ai'],
      });
      await this.commitPage(prev, page);
    }
    await this.deps.enqueueUpload('pageImage', job.documentId, job.pageIndex).catch(() => undefined);
    this.deps.watchAiReading(job.documentId, job.pageIndex);
  }

  private pageFieldsFor(best: Candidate, threshold: number, prepared: PreparedPage): PageFields {
    const noText = best.blocks.length === 0;
    const low = !noText && best.score < threshold;
    const warnings: PageWarning[] = [];
    if (low) warnings.push('low_confidence');
    if (noText) warnings.push('no_text_found');
    return {
      status: low ? 'low_confidence' : 'ready',
      textSource: best.source,
      blocks: best.blocks,
      confidence: best.score,
      width: prepared.image.width,
      height: prepared.image.height,
      warnings,
    };
  }

  private async localCandidate(image: GrayImage, regions: readonly Rect[], wordList: WordList | null, signal: AbortSignal): Promise<Candidate> {
    const result = await withAbort(recognizePage(this.deps.ocr, image, regions), signal);
    const quality = qualityFromOcrLines(result.lines, result.confidence, wordList);
    return { blocks: blocksFromOcrLines(result.lines), score: quality.score, source: 'ocr-local' };
  }

  /** No orientation detection in the engine: try 180/90/270° on a 1000 px copy (max 3 attempts, §15.6). */
  private async findBetterRotation(image: GrayImage, currentScore: number, threshold: number, wordList: WordList | null, signal: AbortSignal): Promise<QuarterTurn | null> {
    const probes = await withAbort(this.deps.rotationProbes(image, [180, 90, 270]), signal);
    let bestTurn: QuarterTurn | null = null;
    let bestScore = currentScore + 10;
    for (const probe of probes.slice(0, 3)) {
      const candidate = await this.localCandidate(probe.image, [], wordList, signal);
      if (candidate.score > bestScore) {
        bestScore = candidate.score;
        bestTurn = probe.turn;
        if (candidate.score >= threshold) break;
      }
    }
    return bestTurn;
  }

  private async renderPdfImage(pdf: PdfHandle, pdfPageIndex: number, page: PageContent, settings: ParentSettings, signal: AbortSignal): Promise<void> {
    try {
      const rgba = await withAbort(pdf.renderPage(pdfPageIndex, MAX_PAGE_SIDE), signal);
      const prepared = await withAbort(
        this.deps.preparePage(rgba, { deskew: false, crop: false, stretch: false, minSide: 0 }),
        signal,
      );
      await this.storeImages(page.documentId, page.pageIndex, prepared);
      await savePage({ ...page, width: prepared.image.width, height: prepared.image.height, updatedAt: Math.max(this.deps.now(), page.updatedAt + 1) });
      if (settings.privacy.uploadPageImages) await this.deps.enqueueUpload('pageImage', page.documentId, page.pageIndex).catch(() => undefined);
    } catch (error) {
      if (signal.aborted || error instanceof AbortedError) throw error;
      // The text is already readable; the Original view simply has no image.
    }
  }

  private async resolveSource(job: QueueJob): Promise<ResolvedSource> {
    if (job.source) {
      const file = await getDocumentFile(job.documentId, job.source.fileIndex);
      if (file) {
        const kind = detectFileKind({ type: file.mime, name: file.name });
        if (kind === 'pdf') {
          return { kind: 'pdf', blob: file.blob, pdfPageIndex: job.source.pdfPageIndex ?? 0, fileKey: `${job.documentId}:${file.index}` };
        }
        if (kind === 'image') return { kind: 'image', blob: file.blob };
      }
    }
    // Page synced from another device (no local original): work from the processed image.
    const processed = await this.deps.loadProcessedImage(job.documentId, job.pageIndex);
    if (processed) return { kind: 'processed', blob: processed };
    throw new ProcessingError('source_missing', { permanent: true });
  }

  private async getPdf(key: string, blob: Blob): Promise<PdfHandle> {
    if (this.pdf?.key === key) return this.pdf.handle;
    await this.closePdf();
    const handle = await this.deps.openPdf(blob);
    this.pdf = { key, handle };
    return handle;
  }

  private async closePdf(): Promise<void> {
    const current = this.pdf;
    this.pdf = null;
    if (current) await current.handle.destroy().catch(() => undefined);
  }

  private async storeImages(documentId: Id, pageIndex: number, prepared: PreparedPage): Promise<void> {
    const { width, height } = prepared.image;
    const scale = Math.min(1, THUMB_SIDE / Math.max(width, height));
    const records: PageImageRecord[] = [
      { documentId, pageIndex, variant: 'ocr', blob: prepared.jpeg, width, height },
      { documentId, pageIndex, variant: 'thumb', blob: prepared.thumb, width: Math.round(width * scale), height: Math.round(height * scale) },
    ];
    if (prepared.color) {
      records.push({ documentId, pageIndex, variant: 'color', blob: prepared.color.jpeg, width: prepared.color.width, height: prepared.color.height });
    } else {
      // A color copy of an older frame (before a rotation or a new photo) would no longer match the page.
      await db.pageImages.delete([documentId, pageIndex, 'color']);
    }
    await putPageImages(records);
  }

  private async buildPage(prev: PageContent, fields: PageFields): Promise<PageContent> {
    return {
      documentId: prev.documentId,
      pageIndex: prev.pageIndex,
      status: fields.status,
      textSource: fields.textSource,
      blocks: fields.blocks,
      confidence: fields.confidence === null ? null : Math.round(fields.confidence),
      contentHash: await computeContentHash(fields.blocks),
      width: fields.width,
      height: fields.height,
      warnings: [...new Set(fields.warnings)],
      updatedAt: Math.max(this.deps.now(), prev.updatedAt + 1),
    };
  }

  /** Re-anchors the child's annotations on the new text (pencil) and saves the page. */
  private async commitPage(prev: PageContent, page: PageContent): Promise<void> {
    if (prev.blocks.length > 0) {
      try {
        await this.deps.reanchor(page.documentId, page.pageIndex, page);
      } catch {
        // Annotations that cannot be moved stay where they are; the new text is still saved.
      }
    }
    await savePage(page);
  }

  private emit(documentId: Id): void {
    for (const listener of this.listeners) listener(documentId);
  }

  // ---------- lifecycle ----------

  private installLifecycle(): void {
    if (this.lifecycleInstalled || typeof window === 'undefined') return;
    this.lifecycleInstalled = true;
    window.addEventListener('pagehide', () => {
      // iPadOS may freeze or kill the tab: stop the workers, the job is resumed on the next start/pageshow.
      this.current?.abort.abort();
      void this.deps.ocr.terminate();
      this.deps.terminateHelpers();
      void this.closePdf();
    });
    window.addEventListener('pageshow', (event: PageTransitionEvent) => {
      if (event.persisted) this.kick();
    });
    window.addEventListener('online', () => this.kick());
    startPendingUploads();
  }
}

interface PageFields {
  status: PageStatus;
  textSource: PageTextSource | null;
  blocks: TextBlock[];
  confidence: number | null;
  width: number | null;
  height: number | null;
  warnings: PageWarning[];
}

/** The « lecture intelligente » needs the page image on the server and the page text synced (§17.5). */
export function awaitsAiTranscription(settings: ParentSettings): boolean {
  return settings.ocr.aiTranscription === true && settings.privacy.uploadPageImages && settings.privacy.syncDocumentText;
}

function validQuad(quad: [number, number][] | undefined): [number, number][] | null {
  if (!quad || quad.length !== 4) return null;
  if (!quad.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n)))) return null;
  return quad.map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] as [number, number]);
}

export function createProcessingQueue(deps: Partial<QueueDeps> = {}): ProcessingQueue {
  return new ProcessingQueue(deps);
}

const queue = new ProcessingQueue();

export const processingQueue: {
  start(): void;
  subscribe(documentId: Id, cb: (p: DocumentProgress) => void): () => void;
  reprocessPage(documentId: Id, pageIndex: number, opts?: ReprocessOptions): Promise<void>;
  replacePageImage(documentId: Id, pageIndex: number, file: File): Promise<void>;
  savePageCorrection(documentId: Id, pageIndex: number, blocks: TextBlock[]): Promise<PageContent>;
  cancelDocument(documentId: Id): Promise<void>;
  kick(): void;
} = {
  start: () => queue.start(),
  subscribe: (documentId, cb) => queue.subscribe(documentId, cb),
  reprocessPage: (documentId, pageIndex, opts) => queue.reprocessPage(documentId, pageIndex, opts),
  replacePageImage: (documentId, pageIndex, file) => queue.replacePageImage(documentId, pageIndex, file),
  savePageCorrection: (documentId, pageIndex, blocks) => queue.savePageCorrection(documentId, pageIndex, blocks),
  cancelDocument: (documentId) => queue.cancelDocument(documentId),
  kick: () => queue.kick(),
};

/** §25 React hook: the pages of this account are read by the home computer (settings and worker on the server). */
export function usePagesReadByAi(): boolean {
  const settings = useSessionStore((s) => s.parentSettings) ?? DEFAULT_PARENT_SETTINGS;
  const aiReading = useSessionStore((s) => s.authStatus?.aiReading === true);
  return awaitsAiTranscription(settings) && aiReading;
}

/** React hook: live progress of a document, null until known. */
export function useDocumentProgress(documentId: Id): DocumentProgress | null {
  const [progress, setProgress] = useState<DocumentProgress | null>(null);
  useEffect(() => {
    setProgress(null);
    if (!documentId) return;
    return processingQueue.subscribe(documentId, setProgress);
  }, [documentId]);
  return progress;
}
