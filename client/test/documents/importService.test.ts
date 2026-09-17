import { sha256Hex } from '@aide/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { toQueueJob } from '../../src/documents/DocumentCache';
import { useSessionStore } from '../../src/state/session';
import { clearDb, settings } from './queueHarness';

const mocks = vi.hoisted(() => ({
  countPdfPages: vi.fn(async (_file: Blob) => 3),
  canDecodeImage: vi.fn(async (_blob: Blob) => true),
  start: vi.fn(),
}));

vi.mock('../../src/documents/PDFReader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/documents/PDFReader')>()),
  countPdfPages: mocks.countPdfPages,
}));
vi.mock('../../src/ocr/preprocess/canvas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ocr/preprocess/canvas')>()),
  canDecodeImage: mocks.canDecodeImage,
}));
vi.mock('../../src/documents/ProcessingQueue', () => ({ processingQueue: { start: mocks.start } }));

const { analyzeFile, computeSourceHash, importFiles, ImportError } = await import('../../src/documents/ImportService');

function file(content: string, name: string, type: string): File {
  return new File([content], name, { type });
}

describe('ImportService', () => {
  beforeEach(async () => {
    await clearDb();
    mocks.countPdfPages.mockClear();
    mocks.canDecodeImage.mockReset();
    mocks.canDecodeImage.mockResolvedValue(true);
    mocks.start.mockClear();
    useSessionStore.setState({
      authStatus: {
        setupRequired: false, authenticated: true, parentUnlockedUntil: null, pinSet: true, pinLockedUntil: null, registrationOpen: false,
        parent: { id: 'parent-1', email: 'parent', displayName: 'Parent', createdAt: 1, isOwner: true },
      },
      parentSettings: settings(),
    });
  });

  it('creates the document, pending pages in file order, jobs and local originals, then starts the queue', async () => {
    const files = [
      file('photo-a', 'a.jpg', 'image/jpeg'),
      file('%PDF-1.7', 'cours.pdf', 'application/pdf'),
      file('photo-b', 'b.png', 'image/png'),
    ];
    const id = await importFiles(files, { title: '  Sciences  ', childIds: ['c1', 'c2', 'c1'] });

    const doc = await db.documents.get(id);
    expect(doc).toMatchObject({
      id, ownerParentId: 'parent-1', childIds: ['c1', 'c2'], title: 'Sciences', kind: 'pdf', pageCount: 5, status: 'processing', deletedAt: null,
    });
    const hashes = [await sha256Hex('photo-a'), await sha256Hex('%PDF-1.7'), await sha256Hex('photo-b')];
    expect(doc?.sourceHash).toBe(await sha256Hex(hashes.join('')));

    const pages = await db.pages.where('documentId').equals(id).sortBy('pageIndex');
    expect(pages.map((p) => [p.pageIndex, p.status, p.textSource])).toEqual([
      [0, 'pending', null], [1, 'pending', null], [2, 'pending', null], [3, 'pending', null], [4, 'pending', null],
    ]);
    const jobs = (await db.jobs.where('documentId').equals(id).toArray()).map(toQueueJob).sort((a, b) => a.pageIndex - b.pageIndex);
    expect(jobs.map((j) => [j.pageIndex, j.state, j.attempts, j.source])).toEqual([
      [0, 'queued', 0, { fileIndex: 0, pdfPageIndex: null }],
      [1, 'queued', 0, { fileIndex: 1, pdfPageIndex: 0 }],
      [2, 'queued', 0, { fileIndex: 1, pdfPageIndex: 1 }],
      [3, 'queued', 0, { fileIndex: 1, pdfPageIndex: 2 }],
      [4, 'queued', 0, { fileIndex: 2, pdfPageIndex: null }],
    ]);
    const stored = await db.documentFiles.where('documentId').equals(id).sortBy('index');
    expect(stored.map((f) => [f.index, f.name, f.mime])).toEqual([
      [0, 'a.jpg', 'image/jpeg'], [1, 'cours.pdf', 'application/pdf'], [2, 'b.png', 'image/png'],
    ]);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(await db.kv.get('pendingUploads')).toBeUndefined();
  });

  it('marks an image-only import as kind images and uses the file name as a fallback title', async () => {
    const id = await importFiles([file('x', 'Leçon_volcans.jpeg', 'image/jpeg')], { title: ' ', childIds: [] });
    expect(await db.documents.get(id)).toMatchObject({ kind: 'images', title: 'Leçon volcans', pageCount: 1 });
  });

  it('queues original uploads only when the parent allowed it', async () => {
    useSessionStore.setState({ parentSettings: settings({ privacy: { uploadOriginals: true } }) });
    const id = await importFiles([file('x', 'a.jpg', 'image/jpeg'), file('y', 'b.jpg', 'image/jpeg')], { title: 'T', childIds: [] });
    const pending = (await db.kv.get('pendingUploads'))?.value as { kind: string; documentId: string; index: number }[];
    expect(pending.map((p) => [p.kind, p.documentId, p.index])).toEqual([
      ['original', id, 0],
      ['original', id, 1],
    ]);
  });

  it('rejects unsupported files and undecodable HEIC photos before writing anything', async () => {
    await expect(importFiles([file('x', 'notes.txt', 'text/plain')], { title: 'T', childIds: [] })).rejects.toMatchObject({
      code: 'unsupported_file', fileName: 'notes.txt',
    });
    mocks.canDecodeImage.mockResolvedValue(false);
    const error = await importFiles([file('x', 'IMG_1.HEIC', 'image/heic')], { title: 'T', childIds: [] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect((error as InstanceType<typeof ImportError>).code).toBe('heic_unsupported');
    expect(await db.documents.count()).toBe(0);
    expect(await db.jobs.count()).toBe(0);
    await expect(importFiles([], { title: 'T', childIds: [] })).rejects.toMatchObject({ code: 'no_files' });
  });

  it('only checks decodability for HEIC and reports unreadable PDFs', async () => {
    await analyzeFile(file('x', 'a.jpg', 'image/jpeg'));
    expect(mocks.canDecodeImage).not.toHaveBeenCalled();
    mocks.countPdfPages.mockRejectedValueOnce(new Error('bad'));
    await expect(analyzeFile(file('x', 'a.pdf', 'application/pdf'))).rejects.toMatchObject({ code: 'pdf_unreadable' });
    mocks.countPdfPages.mockResolvedValueOnce(0);
    await expect(analyzeFile(file('x', 'a.pdf', 'application/pdf'))).rejects.toMatchObject({ code: 'empty_pdf' });
  });

  it('hashes files in order', async () => {
    const a = new Blob(['a']);
    const b = new Blob(['b']);
    expect(await computeSourceHash([a, b])).not.toBe(await computeSourceHash([b, a]));
  });
});
