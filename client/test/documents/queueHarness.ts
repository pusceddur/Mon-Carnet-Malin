// Test harness for the processing queue: Dexie (fake-indexeddb) seeding and mocked OCR / preprocessing dependencies.
import { DEFAULT_PARENT_SETTINGS, createWordList, type DocumentMeta, type ParentSettings, type WordList } from '@aide/shared';
import { vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { newJob, type QueueJob } from '../../src/documents/DocumentCache';
import { pendingPage } from '../../src/documents/DocumentParser';
import type { QueueDeps } from '../../src/documents/ProcessingQueue';
import { OcrUnavailableError, type OcrEngine } from '../../src/ocr/BrowserOCR';
import type { OcrLine, OcrResult } from '../../src/ocr/ocrLines';
import type { PreparedPage } from '../../src/ocr/preprocess/client';
import type { GrayImage, RgbaImage } from '../../src/ocr/preprocess/image';
import type { PreprocessOptions } from '../../src/ocr/preprocess/pipeline';
import type { ServerOcrOutcome } from '../../src/ocr/ServerOCR';

export const GOOD_SENTENCE = 'La petite fille lit un livre dans le jardin avec son chat';
export const BAD_SENTENCE = 'Lz pqtite f1lle ||t vn l1vre d@ns xe jqrdin';

export const wordList: WordList = createWordList(
  'la petite fille lit un livre dans le jardin avec son chat page soleil brille sur la maison'.split(' '),
);

export async function clearDb(): Promise<void> {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
}

export function settings(overrides: { ocr?: Partial<ParentSettings['ocr']>; privacy?: Partial<ParentSettings['privacy']> } = {}): ParentSettings {
  return {
    ...DEFAULT_PARENT_SETTINGS,
    ocr: { ...DEFAULT_PARENT_SETTINGS.ocr, ...overrides.ocr },
    privacy: { ...DEFAULT_PARENT_SETTINGS.privacy, ...overrides.privacy },
  };
}

export interface SeedOptions {
  id?: string;
  pages: number;
  kind?: 'images' | 'pdf';
  /** Initial job state for every page. */
  jobState?: QueueJob['state'];
  attempts?: number;
}

/** Document with one image file per page (or one PDF file), pending pages and queued jobs. */
export async function seedDocument(options: SeedOptions): Promise<string> {
  const id = options.id ?? `doc-${Math.random().toString(36).slice(2)}`;
  const now = 1_000;
  const meta: DocumentMeta = {
    id,
    ownerParentId: 'parent-1',
    childIds: ['child-1'],
    title: 'Sciences',
    kind: options.kind ?? 'images',
    sourceHash: 'hash',
    pageCount: options.pages,
    status: 'processing',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await db.documents.put(meta);
  if (options.kind === 'pdf') {
    await db.documentFiles.put({ documentId: id, index: 0, name: 'cours.pdf', mime: 'application/pdf', size: 10, blob: new Blob(['%PDF']) });
  }
  for (let i = 0; i < options.pages; i++) {
    if (options.kind !== 'pdf') {
      await db.documentFiles.put({ documentId: id, index: i, name: `page${i}.jpg`, mime: 'image/jpeg', size: 10, blob: new Blob([`img${i}`]) });
    }
    await db.pages.put(pendingPage(id, i, now));
    const job = newJob(id, i, { fileIndex: options.kind === 'pdf' ? 0 : i, pdfPageIndex: options.kind === 'pdf' ? i : null }, now);
    job.state = options.jobState ?? 'queued';
    job.attempts = options.attempts ?? 0;
    await db.jobs.put(job);
  }
  return id;
}

export function ocrResult(sentence: string, confidence: number): OcrResult {
  const words = sentence.split(' ').map((text) => ({ text, confidence }));
  const line: OcrLine = { text: sentence, top: 10, left: 10, height: 20, words };
  return { lines: [line], confidence };
}

export interface Harness {
  deps: QueueDeps;
  ocr: OcrEngine & { recognize: ReturnType<typeof vi.fn> };
  preparePage: ReturnType<typeof vi.fn>;
  prepareFallback: ReturnType<typeof vi.fn>;
  recognizeOnServer: ReturnType<typeof vi.fn>;
  reanchor: ReturnType<typeof vi.fn>;
  enqueueUpload: ReturnType<typeof vi.fn>;
  clock: { now: number };
  online: { value: boolean };
  settings: { value: ParentSettings };
}

/** Neither the on-device engine nor the server can read anything (the case handed over to the « lecture intelligente »). */
export function readingFailsEverywhere(h: Harness): void {
  h.ocr.recognize.mockRejectedValue(new OcrUnavailableError());
  h.recognizeOnServer.mockResolvedValue({ status: 'unavailable', reason: 'error' });
}

export function fakeImage(width: number, height = 100, fill = 200): GrayImage {
  return { width, height, data: new Uint8ClampedArray(width * height).fill(fill) };
}

/**
 * Default behaviour: preparePage returns a gray image whose width is 1000 + the rotation, the OCR reads a good sentence.
 * Override `ocr.recognize` / `preparePage` in each test as needed.
 */
export function createHarness(): Harness {
  const clock = { now: 10_000 };
  const online = { value: true };
  const currentSettings = { value: settings() };
  const preparePage = vi.fn(async (_source: Blob | RgbaImage, options: PreprocessOptions): Promise<PreparedPage> => ({
    image: fakeImage(1000 + (options.rotateDegrees ?? 0)),
    skewDegrees: 0,
    regions: [],
    jpeg: new Blob(['jpeg'], { type: 'image/jpeg' }),
    thumb: new Blob(['thumb'], { type: 'image/jpeg' }),
  }));
  const prepareFallback = vi.fn(async (): Promise<PreparedPage> => ({
    image: fakeImage(800),
    skewDegrees: 0,
    regions: [],
    jpeg: new Blob(['small-jpeg'], { type: 'image/jpeg' }),
    thumb: new Blob(['thumb'], { type: 'image/jpeg' }),
  }));
  const recognize = vi.fn(async (): Promise<OcrResult> => ocrResult(GOOD_SENTENCE, 95));
  const ocr = { recognize, notePageDone: vi.fn(), terminate: vi.fn(async () => undefined) };
  const recognizeOnServer = vi.fn(async (): Promise<ServerOcrOutcome> => ({ status: 'unavailable', reason: 'error' }));
  const reanchor = vi.fn(async () => undefined);
  const enqueueUpload = vi.fn(async () => undefined);
  const deps: QueueDeps = {
    ocr,
    recognizeOnServer,
    openPdf: vi.fn(async () => {
      throw new Error('no pdf in this test');
    }),
    preparePage,
    prepareFallback,
    binarize: vi.fn(async (image: GrayImage) => ({ ...image, width: image.width + 1 })),
    rotationProbes: vi.fn(async (image: GrayImage, turns) => turns.map((turn: 90 | 180 | 270) => ({ turn, image: fakeImage(500 + turn, 50) }))),
    loadWordList: async () => wordList,
    getSettings: async () => currentSettings.value,
    isOnline: () => online.value,
    reanchor,
    enqueueUpload,
    canDecodeImage: async () => true,
    loadProcessedImage: async (documentId, pageIndex) => (await db.pageImages.get([documentId, pageIndex, 'ocr']))?.blob ?? null,
    requestWakeLock: async () => () => undefined,
    terminateHelpers: () => undefined,
    now: () => clock.now,
  };
  return { deps, ocr, preparePage, prepareFallback, recognizeOnServer, reanchor, enqueueUpload, clock, online, settings: currentSettings };
}
