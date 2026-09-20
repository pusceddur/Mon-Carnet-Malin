// Import of PDF / image / EPUB files: hashes, DocumentMeta, pages, persisted jobs, local originals, queue start.
import { newId, sha256Hex, type DocumentKind, type DocumentMeta, type DocumentPurpose, type DocumentTextMode, type Id, type PageContent } from '@aide/shared';
import { db, type DocumentFileRecord } from '../db/localDb';
import { documents as t } from '../i18n/fr/documents';
import { canDecodeImage } from '../ocr/preprocess/canvas';
import { requestPersistentStorage } from '../platform/support';
import { saveEntity } from '../sync/SyncEngine';
import { getOwnerParentId, getParentSettings, newJob, type QueueJob } from './DocumentCache';
import { computeContentHash, detectFileKind, EPUB_MIME, isHeic, pendingPage, titleFromFileName, type ImportFileKind } from './DocumentParser';
import { EpubError, readEpubBlob, type EpubBook } from './EpubReader';
import { enqueueUpload } from './pendingUploads';
import { countPdfPages } from './PDFReader';
import { processingQueue } from './ProcessingQueue';

export const MAX_IMPORT_PAGES = 500;

export type ImportErrorCode =
  | 'no_files'
  | 'unsupported_file'
  | 'heic_unsupported'
  | 'pdf_unreadable'
  | 'empty_pdf'
  | 'too_many_pages'
  | 'too_large'
  | 'epub_protected'
  | 'epub_unreadable'
  | 'epub_must_be_alone'
  | 'storage_failed';

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  /** Name of the file concerned, when any. */
  readonly fileName: string | null;

  constructor(code: ImportErrorCode, fileName: string | null = null) {
    super(code);
    this.name = 'ImportError';
    this.code = code;
    this.fileName = fileName;
  }
}

export interface AnalyzedFile {
  file: File;
  kind: ImportFileKind;
  pageCount: number;
  /** EPUB title (dc:title), null otherwise. */
  title: string | null;
}

// The import form analyzes a book once when it is added; the import itself reuses that reading.
const epubReadings = new WeakMap<Blob, Promise<EpubBook>>();

function readEpubOnce(file: File): Promise<EpubBook> {
  let reading = epubReadings.get(file);
  if (!reading) {
    reading = readEpubBlob(file);
    epubReadings.set(file, reading);
    reading.catch(() => epubReadings.delete(file));
  }
  return reading;
}

async function readEpubFile(file: File): Promise<EpubBook> {
  try {
    return await readEpubOnce(file);
  } catch (error) {
    throw new ImportError(error instanceof EpubError ? error.code : 'epub_unreadable', file.name);
  }
}

/** Checks one file: kind, PDF / EPUB page count, HEIC decodability. Throws ImportError. */
export async function analyzeFile(file: File): Promise<AnalyzedFile> {
  const kind = detectFileKind(file);
  if (!kind) throw new ImportError('unsupported_file', file.name);
  if (kind === 'image') {
    // HEIC is only accepted when this browser can decode it (§15.6).
    if (isHeic(file) && !(await canDecodeImage(file))) throw new ImportError('heic_unsupported', file.name);
    return { file, kind, pageCount: 1, title: null };
  }
  if (kind === 'epub') {
    const book = await readEpubFile(file);
    return { file, kind, pageCount: book.pages.length, title: book.title };
  }
  let pageCount: number;
  try {
    pageCount = await countPdfPages(file);
  } catch {
    // Encrypted, damaged or not a PDF at all.
    throw new ImportError('pdf_unreadable', file.name);
  }
  if (pageCount < 1) throw new ImportError('empty_pdf', file.name);
  return { file, kind, pageCount, title: null };
}

/** sha256 of the concatenated per-file sha256 hex digests, in order (contract §5). */
export async function computeSourceHash(files: readonly Blob[]): Promise<string> {
  const hashes: string[] = [];
  for (const file of files) hashes.push(await sha256Hex(await file.arrayBuffer()));
  return sha256Hex(hashes.join(''));
}

/** An EPUB is a whole book: it cannot share a document with other files. */
export function mixedEpubName(files: readonly { type: string; name: string }[]): string | null {
  if (files.length < 2) return null;
  return files.find((f) => detectFileKind(f) === 'epub')?.name ?? null;
}

export interface ImportOptions {
  title: string;
  childIds: Id[];
  /** §17.10 « Texte écrit par un enfant » ('punctuated'); an EPUB is always faithful. Default 'faithful'. */
  textMode?: DocumentTextMode;
  /** §19.3 'homework': a sheet to complete in the app (not for an EPUB). Default 'reading'. */
  purpose?: DocumentPurpose;
}

/**
 * PDF / images: DocumentMeta + 'pending' pages + jobs, originals kept locally, queue started.
 * EPUB: every page is saved 'ready' at once, without any job. Returns the document id.
 */
export async function importFiles(files: File[], opts: ImportOptions): Promise<Id> {
  if (files.length === 0) throw new ImportError('no_files');
  const mixedEpub = mixedEpubName(files);
  if (mixedEpub !== null) throw new ImportError('epub_must_be_alone', mixedEpub);
  if (detectFileKind(files[0]!) === 'epub') return importEpub(files[0]!, opts);

  const analyzed: AnalyzedFile[] = [];
  for (const file of files) analyzed.push(await analyzeFile(file));
  const pageCount = analyzed.reduce((sum, f) => sum + f.pageCount, 0);
  if (pageCount > MAX_IMPORT_PAGES) throw new ImportError('too_many_pages');

  const now = Date.now();
  const documentId = newId();
  const kind: DocumentKind = analyzed.some((f) => f.kind === 'pdf') ? 'pdf' : 'images';
  const title = opts.title.trim() || titleFromFileName(files[0]!.name) || t.importPage.defaultTitle;
  const sourceHash = await computeSourceHash(files);

  const fileRecords: DocumentFileRecord[] = analyzed.map((f, index) => ({
    documentId,
    index,
    name: f.file.name,
    mime: f.file.type || (f.kind === 'pdf' ? 'application/pdf' : 'image/jpeg'),
    size: f.file.size,
    blob: f.file,
  }));
  const jobs: QueueJob[] = [];
  let pageIndex = 0;
  analyzed.forEach((f, fileIndex) => {
    for (let p = 0; p < f.pageCount; p++) {
      jobs.push(newJob(documentId, pageIndex, { fileIndex, pdfPageIndex: f.kind === 'pdf' ? p : null }, now));
      pageIndex++;
    }
  });

  // Ask Safari to keep the data (non-installed sites may be evicted after 7 days of inactivity).
  void requestPersistentStorage();

  try {
    // Local-only records first (atomic); the queue deletes jobs whose document never got saved.
    await db.transaction('rw', [db.documentFiles, db.jobs], async () => {
      await db.documentFiles.bulkPut(fileRecords);
      await db.jobs.bulkPut(jobs);
    });
    const meta: DocumentMeta = {
      id: documentId,
      ownerParentId: await getOwnerParentId(),
      childIds: [...new Set(opts.childIds)],
      title: title.slice(0, 200),
      kind,
      textMode: opts.textMode ?? 'faithful',
      purpose: opts.purpose ?? 'reading',
      homeworkDoneAt: null,
      sourceHash,
      pageCount,
      status: 'processing',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await saveEntity('documents', meta);
    for (let i = 0; i < pageCount; i++) await saveEntity('pages', pendingPage(documentId, i, now));
  } catch {
    await db.transaction('rw', [db.documentFiles, db.jobs], async () => {
      await db.documentFiles.where('documentId').equals(documentId).delete();
      await db.jobs.where('documentId').equals(documentId).delete();
    }).catch(() => undefined);
    throw new ImportError('storage_failed');
  }

  const settings = await getParentSettings();
  if (settings.privacy.uploadOriginals) {
    for (const record of fileRecords) await enqueueUpload('original', documentId, record.index).catch(() => undefined);
  }
  processingQueue.start();
  return documentId;
}

async function importEpub(file: File, opts: ImportOptions): Promise<Id> {
  const book = await readEpubFile(file);
  const pageCount = book.pages.length;
  if (pageCount > MAX_IMPORT_PAGES) throw new ImportError('too_many_pages');

  const now = Date.now();
  const documentId = newId();
  const title = opts.title.trim() || book.title || titleFromFileName(file.name) || t.importPage.defaultTitle;
  const sourceHash = await computeSourceHash([file]);
  const pages: PageContent[] = [];
  for (const [pageIndex, blocks] of book.pages.entries()) {
    pages.push({
      documentId,
      pageIndex,
      status: 'ready',
      textSource: 'epub-text',
      blocks,
      confidence: null,
      contentHash: await computeContentHash(blocks),
      width: null,
      height: null,
      warnings: [],
      updatedAt: now,
    });
  }

  void requestPersistentStorage();

  try {
    await db.documentFiles.put({ documentId, index: 0, name: file.name, mime: file.type || EPUB_MIME, size: file.size, blob: file });
    const meta: DocumentMeta = {
      id: documentId,
      ownerParentId: await getOwnerParentId(),
      childIds: [...new Set(opts.childIds)],
      title: title.slice(0, 200),
      kind: 'epub',
      textMode: 'faithful',
      purpose: 'reading',
      homeworkDoneAt: null,
      sourceHash,
      pageCount,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await saveEntity('documents', meta);
    for (const page of pages) await saveEntity('pages', page);
  } catch {
    await db.documentFiles.where('documentId').equals(documentId).delete().catch(() => undefined);
    throw new ImportError('storage_failed');
  }
  // §20: like PDF and photos, the book is kept on the server when the parent allows it (another iPad can open it).
  if ((await getParentSettings()).privacy.uploadOriginals) await enqueueUpload('original', documentId, 0).catch(() => undefined);
  return documentId;
}
