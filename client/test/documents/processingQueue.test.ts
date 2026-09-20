import type { PageContent } from '@aide/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { getJob } from '../../src/documents/DocumentCache';
import type { PdfHandle } from '../../src/documents/PDFReader';
import { computeProgress, createProcessingQueue, ProcessingError, type DocumentProgress, type ProcessingQueue } from '../../src/documents/ProcessingQueue';
import { OcrUnavailableError } from '../../src/ocr/BrowserOCR';
import { flushDiagnostics, setDiagnosticsSender } from '../../src/platform/diagnostics';
import type { ClientDiagnosticReport } from '@aide/shared';
import { BAD_SENTENCE, clearDb, createHarness, GOOD_SENTENCE, ocrResult, readingFailsEverywhere, seedDocument, settings, type Harness } from './queueHarness';

async function page(documentId: string, pageIndex: number): Promise<PageContent> {
  const p = await db.pages.get([documentId, pageIndex]);
  if (!p) throw new Error('page missing');
  return p;
}

describe('ProcessingQueue', () => {
  let h: Harness;
  let queue: ProcessingQueue;

  beforeEach(async () => {
    await clearDb();
    h = createHarness();
    queue = createProcessingQueue(h.deps);
  });

  afterEach(async () => {
    queue.stop();
    await queue.whenIdle();
  });

  it('processes pages one at a time, in order: page 1 is readable before page 2 is read', async () => {
    const id = await seedDocument({ pages: 3 });
    const statusesSeen: string[][] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    h.ocr.recognize.mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      const pages = await db.pages.where('documentId').equals(id).sortBy('pageIndex');
      statusesSeen.push(pages.map((p) => p.status));
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent--;
      return ocrResult(GOOD_SENTENCE, 95);
    });

    queue.start();
    await queue.whenIdle();

    expect(maxConcurrent).toBe(1);
    expect(statusesSeen).toEqual([
      ['pending', 'pending', 'pending'],
      ['ready', 'pending', 'pending'],
      ['ready', 'ready', 'pending'],
    ]);
    const p0 = await page(id, 0);
    expect(p0.textSource).toBe('ocr-local');
    expect(p0.blocks.map((b) => b.text).join(' ')).toContain('petite fille');
    expect(p0.confidence).toBeGreaterThanOrEqual(70);
    expect(p0.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p0.width).toBe(1000);
    expect((await db.documents.get(id))?.status).toBe('ready');
    expect(await db.pageImages.where('documentId').equals(id).count()).toBe(9); // ocr + color + thumb per page
    expect((await getJob(id, 2))?.state).toBe('done');
    expect(h.ocr.notePageDone).toHaveBeenCalledTimes(3);
  });

  it('reports progress to subscribers', async () => {
    const id = await seedDocument({ pages: 2 });
    const seen: DocumentProgress[] = [];
    const unsubscribe = queue.subscribe(id, (p) => seen.push(p));
    queue.start();
    await queue.whenIdle();
    await vi.waitFor(() => expect(seen.at(-1)?.percent).toBe(100));
    unsubscribe();
    expect(seen.some((p) => p.processingPageIndex === 0)).toBe(true);
    expect(seen.at(-1)).toMatchObject({ total: 2, ready: 2, failed: 0, lowConfidence: 0, processingPageIndex: null });
  });

  it('computes progress counts', () => {
    const p = computeProgress('d', [
      { pageIndex: 0, status: 'ready' },
      { pageIndex: 1, status: 'low_confidence' },
      { pageIndex: 2, status: 'failed' },
      { pageIndex: 3, status: 'pending' },
    ], 3);
    expect(p).toEqual({ documentId: 'd', total: 4, ready: 1, lowConfidence: 1, failed: 1, processingPageIndex: 3, percent: 75 });
  });

  it('tries a binarized image when the reading on the device is doubtful, and keeps the best', async () => {
    const id = await seedDocument({ pages: 1 });
    h.ocr.recognize.mockResolvedValueOnce(ocrResult(BAD_SENTENCE, 40)).mockResolvedValueOnce(ocrResult(GOOD_SENTENCE, 92));

    queue.start();
    await queue.whenIdle();

    expect(h.deps.binarize).toHaveBeenCalledTimes(1);
    const p = await page(id, 0);
    expect(p).toMatchObject({ status: 'ready', textSource: 'ocr-local', warnings: [] });
    expect(p.blocks[0]?.text).toBe(GOOD_SENTENCE);
    expect(h.enqueueUpload).toHaveBeenCalledWith('pageImage', id, 0);
    expect(h.watchAiReading).not.toHaveBeenCalled();
  });

  it('marks the page low_confidence (document partial) when offline', async () => {
    const id = await seedDocument({ pages: 1 });
    h.online.value = false;
    h.ocr.recognize.mockResolvedValue(ocrResult(BAD_SENTENCE, 45));
    queue.start();
    await queue.whenIdle();
    const p = await page(id, 0);
    expect(p.status).toBe('low_confidence');
    expect(p.warnings).toContain('low_confidence');
    expect((await db.documents.get(id))?.status).toBe('partial');
  });

  it('a later reading by the server queued by an older version of the app is dropped', async () => {
    const id = await seedDocument({ pages: 1 });
    h.ocr.recognize.mockResolvedValue(ocrResult(BAD_SENTENCE, 45));
    queue.start();
    await queue.whenIdle();
    const before = await page(id, 0);
    const job = await getJob(id, 0);
    if (!job) throw new Error('job missing');
    const legacy = { ...job, state: 'queued' as const, stage: 'server_retry' as const, mode: 'server', notBefore: 0 };
    await db.jobs.put(legacy);
    h.ocr.recognize.mockClear();
    queue.kick();
    await queue.whenIdle();
    expect(await page(id, 0)).toEqual(before);
    expect(h.ocr.recognize).not.toHaveBeenCalled();
    expect(await getJob(id, 0)).toMatchObject({ state: 'done', mode: 'auto' });
  });

  it('tries rotations on a small copy and keeps a better orientation', async () => {
    const id = await seedDocument({ pages: 1 });
    h.online.value = false;
    h.ocr.recognize.mockImplementation(async (bytes: Uint8Array) => {
      const header = new TextDecoder().decode(bytes.subarray(0, 20));
      // Probe images are 500 + turn wide; the full image rotated by 180° is 1180 wide (harness convention).
      if (header.includes('\n680 ') || header.includes('\n1180 ')) return ocrResult(GOOD_SENTENCE, 93);
      return ocrResult(BAD_SENTENCE, 35);
    });
    queue.start();
    await queue.whenIdle();
    const p = await page(id, 0);
    expect(p.status).toBe('ready');
    expect(p.width).toBe(1180);
    expect((await getJob(id, 0))?.rotateDegrees).toBe(180);
    expect(h.preparePage.mock.calls.at(-1)?.[1]).toMatchObject({ rotateDegrees: 180 });
  });

  it('reads the PDF text layer without OCR when a page has enough letters', async () => {
    const id = await seedDocument({ pages: 2, kind: 'pdf' });
    const handle: PdfHandle = {
      numPages: 2,
      getPageLines: vi.fn(async (index: number) =>
        index === 0
          ? [
              { text: 'Chapitre 1', top: 10, left: 10, height: 20, fontSize: 20 },
              { text: 'La petite fille lit un livre dans le jardin avec son chat.', top: 40, left: 10, height: 12, fontSize: 12 },
            ]
          : [{ text: '12', top: 10, left: 10, height: 12 }],
      ),
      renderPage: vi.fn(async () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 })),
      destroy: vi.fn(async () => undefined),
    };
    h.deps.openPdf = vi.fn(async () => handle);
    queue = createProcessingQueue(h.deps);
    queue.start();
    await queue.whenIdle();

    const p0 = await page(id, 0);
    expect(p0.textSource).toBe('pdf-text');
    expect(p0.confidence).toBeNull();
    expect(p0.blocks.map((b) => b.text).join(' ')).toContain('petite fille');
    expect(p0.width).toBe(1000);
    const p1 = await page(id, 1);
    expect(p1.textSource).toBe('ocr-local');
    expect(h.ocr.recognize).toHaveBeenCalledTimes(1);
    expect(h.deps.openPdf).toHaveBeenCalledTimes(1);
    expect(handle.destroy).toHaveBeenCalled();
  });

  describe('crash-loop guard and resume', () => {
    it('fails a page whose job was still running after two attempts', async () => {
      const id = await seedDocument({ pages: 1, jobState: 'running', attempts: 2 });
      queue.start();
      await queue.whenIdle();
      expect(h.ocr.recognize).not.toHaveBeenCalled();
      expect((await page(id, 0)).status).toBe('failed');
      expect(await getJob(id, 0)).toMatchObject({ state: 'error', error: 'crash_loop' });
      expect((await db.documents.get(id))?.status).toBe('partial');
    });

    it('resumes a job interrupted once (attempts saved before running)', async () => {
      const id = await seedDocument({ pages: 1, jobState: 'running', attempts: 1 });
      queue.start();
      await queue.whenIdle();
      expect((await page(id, 0)).status).toBe('ready');
      expect((await getJob(id, 0))?.state).toBe('done');
    });

    it('saves attempts and the running state before processing', async () => {
      const id = await seedDocument({ pages: 1 });
      let seenJob: unknown = null;
      h.ocr.recognize.mockImplementation(async () => {
        seenJob = await db.jobs.get([id, 0]);
        return ocrResult(GOOD_SENTENCE, 95);
      });
      queue.start();
      await queue.whenIdle();
      expect(seenJob).toMatchObject({ state: 'running', attempts: 1 });
    });

    it('a new queue instance (reload) resumes persisted queued jobs', async () => {
      const id = await seedDocument({ pages: 2 });
      const reloaded = createProcessingQueue(h.deps);
      reloaded.start();
      await reloaded.whenIdle();
      expect((await page(id, 1)).status).toBe('ready');
    });

    it('retries a failing page once, then marks it failed', async () => {
      const id = await seedDocument({ pages: 2 });
      h.settings.value = settings({ ocr: { aiTranscription: false } });
      h.ocr.recognize.mockImplementation(async () => {
        if (queue.processingPageIndex(id) === 0) throw new Error('worker crashed');
        return ocrResult(GOOD_SENTENCE, 95);
      });
      queue.start();
      await queue.whenIdle();
      expect((await page(id, 0)).status).toBe('failed');
      expect(await getJob(id, 0)).toMatchObject({ state: 'error', attempts: 2 });
      expect((await page(id, 1)).status).toBe('ready');
      expect((await db.documents.get(id))?.status).toBe('partial');
    });

    it('fails without retry when the local engine is unavailable and there is no server', async () => {
      const id = await seedDocument({ pages: 1 });
      h.settings.value = settings({ ocr: { aiTranscription: false } });
      h.online.value = false;
      h.ocr.recognize.mockRejectedValue(new OcrUnavailableError());
      queue.start();
      await queue.whenIdle();
      expect((await page(id, 0)).status).toBe('failed');
      expect((await getJob(id, 0))?.error).toBe('ocr_unavailable');
    });

    it('a crash of the on-device engine is not fatal: the page goes to the home computer when there is one', async () => {
      const id = await seedDocument({ pages: 1 });
      h.aiReading.value = true;
      h.ocr.recognize.mockRejectedValue(new Error('recognize_timeout'));
      await queue.reprocessPage(id, 0, { onDevice: true });
      expect(await page(id, 0)).toMatchObject({ status: 'failed', warnings: ['awaiting_ai'] });
      expect(h.watchAiReading).toHaveBeenCalledWith(id, 0);
    });

    it('when the full preprocessing fails (memory), a smaller preparation is used instead of failing the page', async () => {
      const reports: ClientDiagnosticReport[] = [];
      setDiagnosticsSender(async (batch) => {
        reports.push(...batch);
        return true;
      });
      try {
        const id = await seedDocument({ pages: 1 });
        h.preparePage.mockRejectedValue(new Error('RangeError: Out of memory'));
        queue.start();
        await queue.whenIdle();
        const p = await page(id, 0);
        expect(p.status).toBe('ready');
        expect(p.textSource).toBe('ocr-local');
        expect(p.width).toBe(800);
        expect(h.prepareFallback).toHaveBeenCalledTimes(1);
        await flushDiagnostics();
        expect(reports.map((r) => [r.kind, r.stage])).toEqual([['preprocess', 'preprocess']]);
        expect(reports[0]?.message).toContain('Out of memory');
      } finally {
        setDiagnosticsSender(null);
      }
    });

    it('reports a page that finally fails with the step where it failed (never the page text)', async () => {
      const reports: ClientDiagnosticReport[] = [];
      setDiagnosticsSender(async (batch) => {
        reports.push(...batch);
        return true;
      });
      try {
        const id = await seedDocument({ pages: 1 });
        h.online.value = false;
        h.preparePage.mockRejectedValue(new Error('decode failed'));
        h.prepareFallback.mockRejectedValue(new Error('decode failed again'));
        queue.start();
        await queue.whenIdle();
        expect((await page(id, 0)).status).toBe('failed');
        await flushDiagnostics();
        const failed = reports.filter((r) => r.kind === 'processing_failed');
        expect(failed.length).toBeGreaterThanOrEqual(1);
        expect(failed.at(-1)).toMatchObject({ stage: 'preprocess_fallback' });
        expect(failed.at(-1)?.context).toMatchObject({ final: true, pageIndex: 0 });
        expect(JSON.stringify(reports)).not.toContain(GOOD_SENTENCE);
      } finally {
        setDiagnosticsSender(null);
      }
    });

    it('drops jobs of deleted documents', async () => {
      const id = await seedDocument({ pages: 1 });
      const doc = await db.documents.get(id);
      await db.documents.put({ ...doc!, deletedAt: 5 });
      queue.start();
      await queue.whenIdle();
      expect(h.ocr.recognize).not.toHaveBeenCalled();
      expect(await db.jobs.count()).toBe(0);
    });
  });

  describe('lecture intelligente (§25: the home computer reads the pages)', () => {
    beforeEach(() => {
      h.aiReading.value = true;
    });

    it('hands every photo straight over: image kept and uploaded, page waiting, no reading on the device', async () => {
      const id = await seedDocument({ pages: 2 });
      queue.start();
      await queue.whenIdle();

      const p0 = await page(id, 0);
      expect(p0).toMatchObject({ status: 'failed', textSource: null, blocks: [], confidence: null, warnings: ['awaiting_ai'], width: 1000, height: 100 });
      expect(p0.updatedAt).toBeGreaterThan(1_000);
      expect(await db.pageImages.get([id, 0, 'ocr'])).toBeDefined();
      expect(await db.pageImages.get([id, 0, 'thumb'])).toBeDefined();
      expect(h.enqueueUpload).toHaveBeenCalledWith('pageImage', id, 0);
      expect(h.enqueueUpload).toHaveBeenCalledWith('pageImage', id, 1);
      expect(h.watchAiReading).toHaveBeenCalledWith(id, 0);
      expect(h.watchAiReading).toHaveBeenCalledWith(id, 1);
      expect(await getJob(id, 0)).toMatchObject({ state: 'done', error: null, attempts: 0 });
      expect(h.ocr.recognize).not.toHaveBeenCalled();
      expect(h.deps.binarize).not.toHaveBeenCalled();
      expect((await db.documents.get(id))?.status).toBe('partial');
    });

    it('also hands the page over offline (the image upload waits for the connection)', async () => {
      const id = await seedDocument({ pages: 1 });
      h.online.value = false;
      queue.start();
      await queue.whenIdle();
      expect((await page(id, 0)).warnings).toEqual(['awaiting_ai']);
      expect(h.ocr.recognize).not.toHaveBeenCalled();
      expect(h.enqueueUpload).toHaveBeenCalledWith('pageImage', id, 0);
    });

    it('« Lire sur cet appareil » that cannot read gives the page back to the home computer (reported)', async () => {
      const reports: ClientDiagnosticReport[] = [];
      setDiagnosticsSender(async (batch) => {
        reports.push(...batch);
        return true;
      });
      try {
        const id = await seedDocument({ pages: 1 });
        readingFailsEverywhere(h);
        await queue.reprocessPage(id, 0, { onDevice: true });
        expect(await page(id, 0)).toMatchObject({ status: 'failed', warnings: ['awaiting_ai'] });
        expect(h.ocr.recognize).toHaveBeenCalledTimes(1);
        await flushDiagnostics();
        const failed = reports.filter((r) => r.kind === 'processing_failed');
        expect(failed.at(-1)?.context).toMatchObject({ code: 'ocr_unavailable', final: true, awaitingAi: true });
      } finally {
        setDiagnosticsSender(null);
      }
    });

    it.each([
      ['aiTranscription', settings({ ocr: { aiTranscription: false } })],
      ['uploadPageImages', settings({ privacy: { uploadPageImages: false } })],
      ['syncDocumentText', settings({ privacy: { syncDocumentText: false } })],
    ])('is not used when %s is off: the device reads, a page it cannot read fails', async (_flag, value) => {
      const id = await seedDocument({ pages: 1 });
      h.settings.value = value;
      readingFailsEverywhere(h);
      queue.start();
      await queue.whenIdle();
      const p = await page(id, 0);
      expect(p.status).toBe('failed');
      expect(p.warnings).not.toContain('awaiting_ai');
      expect(await getJob(id, 0)).toMatchObject({ state: 'error', error: 'ocr_unavailable' });
      expect(await db.pageImages.where('documentId').equals(id).count()).toBe(0);
      expect(h.enqueueUpload).not.toHaveBeenCalled();
    });

    it('without a home computer on the server, the device reads even when the settings allow the lecture intelligente', async () => {
      const id = await seedDocument({ pages: 1 });
      h.aiReading.value = false;
      readingFailsEverywhere(h);
      queue.start();
      await queue.whenIdle();
      expect(await page(id, 0)).toMatchObject({ status: 'failed', warnings: [] });
      expect(await getJob(id, 0)).toMatchObject({ state: 'error', error: 'ocr_unavailable' });
      expect(h.watchAiReading).not.toHaveBeenCalled();
    });

    it('a waiting page is not read again when the app starts again', async () => {
      const id = await seedDocument({ pages: 1 });
      queue.start();
      await queue.whenIdle();
      const before = await page(id, 0);
      h.preparePage.mockClear();

      const reloaded = createProcessingQueue(h.deps);
      reloaded.start();
      await reloaded.whenIdle();
      reloaded.stop();
      expect(h.preparePage).not.toHaveBeenCalled();
      expect(h.ocr.recognize).not.toHaveBeenCalled();
      expect(await page(id, 0)).toEqual(before);
    });

    it('the transcription synced later is kept: a queued first reading does not overwrite it', async () => {
      const id = await seedDocument({ pages: 1 });
      const synced: PageContent = {
        ...(await page(id, 0)),
        status: 'ready',
        textSource: 'ocr-ai',
        blocks: [{ kind: 'paragraph', text: GOOD_SENTENCE }],
        warnings: [],
        updatedAt: 5_000,
      };
      await db.pages.put(synced);
      queue.start();
      await queue.whenIdle();
      expect(h.ocr.recognize).not.toHaveBeenCalled();
      expect(await page(id, 0)).toEqual(synced);
      expect((await getJob(id, 0))?.state).toBe('done');
    });

    it('a page that already has text keeps it when « Lire sur cet appareil » fails (no hand-over)', async () => {
      const id = await seedDocument({ pages: 1 });
      await queue.reprocessPage(id, 0, { onDevice: true });
      const before = await page(id, 0);
      expect(before.textSource).toBe('ocr-local');
      readingFailsEverywhere(h);
      await expect(queue.reprocessPage(id, 0, { onDevice: true })).rejects.toMatchObject({ code: 'ocr_unavailable' });
      expect(await page(id, 0)).toEqual(before);
    });

    it('a page with text read again by the home computer keeps its text meanwhile', async () => {
      const id = await seedDocument({ pages: 1 });
      await queue.reprocessPage(id, 0, { onDevice: true });
      const before = await page(id, 0);
      h.enqueueUpload.mockClear();
      h.ocr.recognize.mockClear();
      await queue.reprocessPage(id, 0);
      expect(await page(id, 0)).toMatchObject({ status: 'ready', textSource: 'ocr-local', blocks: before.blocks, warnings: [] });
      expect(h.ocr.recognize).not.toHaveBeenCalled();
      expect(h.enqueueUpload).toHaveBeenCalledWith('pageImage', id, 0);
      expect(h.watchAiReading).toHaveBeenCalledWith(id, 0);
    });

    it('« Lire sur cet appareil » on a waiting page reads it on the device', async () => {
      const id = await seedDocument({ pages: 1 });
      queue.start();
      await queue.whenIdle();
      expect((await page(id, 0)).warnings).toEqual(['awaiting_ai']);
      await queue.reprocessPage(id, 0, { onDevice: true });
      expect(await page(id, 0)).toMatchObject({ status: 'ready', textSource: 'ocr-local', warnings: [] });
      expect(await getJob(id, 0)).toMatchObject({ state: 'done', mode: 'auto' });
    });
  });

  describe('parent actions', () => {
    async function readyDocument(): Promise<string> {
      const id = await seedDocument({ pages: 2 });
      queue.start();
      await queue.whenIdle();
      h.ocr.recognize.mockClear();
      h.preparePage.mockClear();
      return id;
    }

    it('reprocessPage applies rotation and frame, re-anchors before saving and resolves when done', async () => {
      const id = await readyDocument();
      const before = await page(id, 1);
      h.ocr.recognize.mockResolvedValue(ocrResult('Le soleil brille sur la maison', 94));
      let pageAtReanchor: PageContent | undefined;
      h.reanchor.mockImplementation(async () => {
        pageAtReanchor = await db.pages.get([id, 1]);
      });
      const quad: [number, number][] = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
      await queue.reprocessPage(id, 1, { rotateDegrees: 90, quad });

      expect(h.preparePage.mock.calls[0]?.[1]).toMatchObject({ rotateDegrees: 90, quad });
      expect(h.reanchor).toHaveBeenCalledTimes(1);
      expect(h.reanchor.mock.calls[0]?.[0]).toBe(id);
      expect(h.reanchor.mock.calls[0]?.[2]).toMatchObject({ blocks: [{ kind: 'paragraph', text: 'Le soleil brille sur la maison' }] });
      expect(pageAtReanchor?.contentHash).toBe(before.contentHash);
      const after = await page(id, 1);
      expect(after.blocks[0]?.text).toBe('Le soleil brille sur la maison');
      expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
      expect(await getJob(id, 1)).toMatchObject({ state: 'done', rotateDegrees: 90, quad });
    });

    it('a failed explicit reading rejects with its code and leaves the job done', async () => {
      const id = await readyDocument();
      readingFailsEverywhere(h);
      const error = await queue.reprocessPage(id, 0).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProcessingError);
      expect((error as ProcessingError).code).toBe('ocr_unavailable');
    });

    it('replacePageImage stores the new photo as the page source and processes it', async () => {
      const id = await readyDocument();
      h.settings.value = settings({ privacy: { uploadOriginals: true } });
      const photo = new File(['new'], 'retake.jpg', { type: 'image/jpeg' });
      await queue.replacePageImage(id, 0, photo);
      const files = await db.documentFiles.where('documentId').equals(id).toArray();
      expect(files.map((f) => f.index).sort()).toEqual([0, 1, 2]);
      expect(await getJob(id, 0)).toMatchObject({ state: 'done', source: { fileIndex: 2, pdfPageIndex: null } });
      expect(h.enqueueUpload).toHaveBeenCalledWith('original', id, 2);
      expect(h.ocr.recognize).toHaveBeenCalledTimes(1);
      expect(h.reanchor).toHaveBeenCalledTimes(1);
    });

    it('replacePageImage refuses a file that is not an image', async () => {
      const id = await readyDocument();
      await expect(queue.replacePageImage(id, 0, new File(['x'], 'notes.txt', { type: 'text/plain' }))).rejects.toMatchObject({ code: 'unsupported_file' });
    });

    it('saves a manual correction with textSource manual and the manually_corrected warning', async () => {
      const id = await seedDocument({ pages: 1 });
      h.online.value = false;
      h.ocr.recognize.mockResolvedValue(ocrResult(BAD_SENTENCE, 40));
      queue.start();
      await queue.whenIdle();
      expect((await db.documents.get(id))?.status).toBe('partial');

      await queue.savePageCorrection(id, 0, [
        { kind: 'title', text: '  Le jardin ' },
        { kind: 'paragraph', text: GOOD_SENTENCE },
        { kind: 'paragraph', text: '   ' },
      ]);
      const p = await page(id, 0);
      expect(p).toMatchObject({ status: 'ready', textSource: 'manual', confidence: null, warnings: ['manually_corrected'] });
      expect(p.blocks).toEqual([{ kind: 'title', text: 'Le jardin' }, { kind: 'paragraph', text: GOOD_SENTENCE }]);
      expect(h.reanchor).toHaveBeenCalledTimes(1);
      expect((await db.documents.get(id))?.status).toBe('ready');
    });

    it('cancelDocument removes the jobs and stops waiting callers', async () => {
      const id = await seedDocument({ pages: 3 });
      let release: () => void = () => undefined;
      h.ocr.recognize.mockImplementation(
        () => new Promise((resolve) => {
          release = () => resolve(ocrResult(GOOD_SENTENCE, 95));
        }),
      );
      queue.start();
      await vi.waitFor(() => expect(queue.processingPageIndex(id)).toBe(0));
      await queue.cancelDocument(id);
      release();
      await queue.whenIdle();
      expect(await db.jobs.where('documentId').equals(id).count()).toBe(0);
      expect(h.ocr.recognize).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ProcessingQueue — texte écrit par un enfant (§17.10)', () => {
  let h: Harness;
  let queue: ProcessingQueue;

  beforeEach(async () => {
    await clearDb();
    h = createHarness();
    h.aiReading.value = true;
    queue = createProcessingQueue(h.deps);
  });

  afterEach(async () => {
    queue.stop();
    await queue.whenIdle();
  });

  it('hands every page straight to the lecture intelligente: no reading on the device, image kept and sent', async () => {
    const id = await seedDocument({ pages: 2, textMode: 'punctuated' });
    queue.start();
    await queue.whenIdle();
    expect(h.ocr.recognize).not.toHaveBeenCalled();
    for (const index of [0, 1]) {
      expect(await page(id, index)).toMatchObject({ status: 'failed', textSource: null, blocks: [], warnings: ['awaiting_ai'], width: 1000, height: 100 });
      expect(await db.pageImages.get([id, index, 'ocr'])).toBeDefined();
      expect(h.enqueueUpload).toHaveBeenCalledWith('pageImage', id, index);
      expect(await getJob(id, index)).toMatchObject({ state: 'done', error: null });
    }
  });

  it('a PDF text layer is shown meanwhile and its page image is sent; a scanned PDF page waits', async () => {
    const id = await seedDocument({ pages: 2, kind: 'pdf', textMode: 'punctuated' });
    const handle: PdfHandle = {
      numPages: 2,
      getPageLines: vi.fn(async (index: number) =>
        index === 0 ? [{ text: 'hier je suis allé au parc avec mon chien il a couru partout', top: 10, left: 10, height: 12, fontSize: 12 }] : [],
      ),
      renderPage: vi.fn(async () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 })),
      destroy: vi.fn(async () => undefined),
    };
    h.deps.openPdf = vi.fn(async () => handle);
    queue = createProcessingQueue(h.deps);
    queue.start();
    await queue.whenIdle();
    expect(await page(id, 0)).toMatchObject({ status: 'ready', textSource: 'pdf-text' });
    expect(await page(id, 1)).toMatchObject({ status: 'failed', warnings: ['awaiting_ai'] });
    expect(h.enqueueUpload).toHaveBeenCalledWith('pageImage', id, 0);
    expect(h.enqueueUpload).toHaveBeenCalledWith('pageImage', id, 1);
    expect(h.ocr.recognize).not.toHaveBeenCalled();
  });

  it('without the lecture intelligente the pages are read on the device as before', async () => {
    const id = await seedDocument({ pages: 1, textMode: 'punctuated' });
    h.settings.value = settings({ ocr: { aiTranscription: false } });
    queue.start();
    await queue.whenIdle();
    expect(await page(id, 0)).toMatchObject({ status: 'ready', textSource: 'ocr-local' });
    expect(h.ocr.recognize).toHaveBeenCalled();
  });

  it('without a home computer on the server the pages are read on the device', async () => {
    const id = await seedDocument({ pages: 1, textMode: 'punctuated' });
    h.aiReading.value = false;
    queue.start();
    await queue.whenIdle();
    expect(await page(id, 0)).toMatchObject({ status: 'ready', textSource: 'ocr-local' });
  });

  it('a new reading (rotation) keeps the current text until the new transcription arrives; « Lire sur cet appareil » still works', async () => {
    const id = await seedDocument({ pages: 1, textMode: 'punctuated' });
    queue.start();
    await queue.whenIdle();
    const transcribed: PageContent = {
      ...(await page(id, 0)),
      status: 'ready',
      textSource: 'ocr-ai',
      blocks: [{ kind: 'paragraph', text: 'Hier, je suis allé au parc.' }],
      warnings: [],
      updatedAt: 20_000,
    };
    await db.pages.put(transcribed);
    h.enqueueUpload.mockClear();
    h.clock.now = 30_000;

    await queue.reprocessPage(id, 0, { rotateDegrees: 90 });
    expect(await page(id, 0)).toMatchObject({ status: 'ready', textSource: 'ocr-ai', blocks: transcribed.blocks, width: 1090 });
    expect(h.enqueueUpload).toHaveBeenCalledWith('pageImage', id, 0);
    expect(h.ocr.recognize).not.toHaveBeenCalled();

    await queue.reprocessPage(id, 0, { onDevice: true });
    expect(h.ocr.recognize).toHaveBeenCalled();
    expect(await page(id, 0)).toMatchObject({ textSource: 'ocr-local' });
  });
});

describe('ProcessingQueue — color copy of the page (§19.1)', () => {
  let h: Harness;
  let queue: ProcessingQueue;

  beforeEach(async () => {
    await clearDb();
    h = createHarness();
    queue = createProcessingQueue(h.deps);
  });

  afterEach(async () => {
    queue.stop();
    await queue.whenIdle();
  });

  it('keeps the color copy with its own size; a reading without one removes the copy of the previous frame', async () => {
    const id = await seedDocument({ pages: 1 });
    queue.start();
    await queue.whenIdle();
    expect(await db.pageImages.get([id, 0, 'color'])).toMatchObject({ variant: 'color', width: 1000, height: 100 });

    // Memory problem on the iPad: the smaller main-thread preparation has no color copy.
    h.preparePage.mockRejectedValueOnce(new Error('out of memory'));
    await queue.reprocessPage(id, 0, { rotateDegrees: 90 });
    expect(await db.pageImages.get([id, 0, 'color'])).toBeUndefined();
    expect(await db.pageImages.get([id, 0, 'ocr'])).toMatchObject({ width: 800 });
  });
});
