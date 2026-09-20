import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import {
  DocumentTextModeRequestSchema, type DocumentTextModeResponse, IdSchema, LIMITS, type OkResponse, PageIndexSchema,
  ReadingPreparationRequestSchema, type ReadingPreparationResponse,
} from '@aide/shared';
import { type Request, type RequestHandler, type Response, Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parentIdOf, rateLimiter, requireAuth, requireParentUnlock } from '../auth/middleware';
import { getDocument, setDocumentTextMode, softDeleteDocument } from '../db/repositories/documents';
import { type FileKind, findStoredFile, saveStoredFile, type StoredFile, storageUsage } from '../db/repositories/files';
import { getParentSettings } from '../db/repositories/settings';
import { withSeq } from '../db/repositories/syncCounters';
import {
  attachmentDisposition, DOCUMENT_FILE_MIMES, detectMime, fileSize, moveIntoStorage, newStoragePath, PAGE_IMAGE_MIMES, readHead,
  removeQuietly, removeStored, resolveStoragePath, sanitizeFileName, sha256File, stripJpegFile, tempUploadDir, type UploadMime,
} from '../db/storage/uploads';
import { appError, ERROR_MESSAGES_FR, parseOrThrow, sendError } from '../errors';
import { uploadsDir } from '../paths';
import type { AppDeps } from '../types';
import { enqueueDocumentTranscriptions, enqueuePageTranscription } from '../worker/pageTranscription';
import {
  enqueueReadingPreparation, READING_PREPARATION_CHILD_MAX_PAGES, readingPreparationUnavailable,
} from '../worker/readingPreparation';

/** §20 bound on uploads per account (a 500-page import spreads over its retries). */
export const UPLOADS_PER_15_MIN = 600;
/** §22 « Préparer la lecture » requests per account. */
export const READING_PREPARATIONS_PER_15_MIN = 60;

const FileIndexSchema = z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().max(LIMITS.documentFileIndexMax));
const PageIndexParamSchema = z.string().regex(/^\d{1,5}$/).transform(Number).pipe(PageIndexSchema);

interface UploadSpec {
  kind: FileKind;
  maxBytes: number;
  mimes: ReadonlySet<UploadMime>;
  prefix: string;
  privacyFlag: 'uploadOriginals' | 'uploadPageImages';
}

const ORIGINAL: UploadSpec = {
  kind: 'original',
  maxBytes: LIMITS.documentFileMaxBytes,
  mimes: DOCUMENT_FILE_MIMES,
  prefix: 'file',
  privacyFlag: 'uploadOriginals',
};

const PAGE_IMAGE: UploadSpec = {
  kind: 'page_image',
  maxBytes: LIMITS.pageImageMaxBytes,
  mimes: PAGE_IMAGE_MIMES,
  prefix: 'page',
  privacyFlag: 'uploadPageImages',
};

/** Mounted by app.ts at `/api/documents`: declare paths relative to that prefix. */
export function createDocumentsRouter(deps: AppDeps): Router {
  const router = Router();
  const auth = requireAuth(deps);
  const unlocked = requireParentUnlock(deps);
  const root = uploadsDir(deps.config);
  // §20: uploads work without the code (background queue, homework added by the child), per account and bounded.
  const uploadLimiter = rateLimiter(deps, { windowMs: 15 * 60_000, limit: UPLOADS_PER_15_MIN, key: (req) => `uploads:${parentIdOf(req)}` });

  const multerFor = (spec: UploadSpec): RequestHandler =>
    multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
          const dir = tempUploadDir(root);
          mkdir(dir, { recursive: true }).then(() => cb(null, dir), (err: Error) => cb(err, dir));
        },
        filename: (_req, _file, cb) => cb(null, `${randomUUID()}.part`),
      }),
      limits: { fileSize: spec.maxBytes, files: 1, fields: 5, fieldSize: 1024, parts: 6 },
      // Browsers send UTF-8 file names in multipart headers (busboy defaults to latin1).
      defParamCharset: 'utf8',
    }).any();

  /** Checks done before reading the multipart body: privacy flag, document ownership, quota already full. */
  const preflight = (spec: UploadSpec): RequestHandler => async (req, _res, next) => {
    const parentId = parentIdOf(req);
    const documentId = parseOrThrow(IdSchema, req.params.id);
    const settings = await getParentSettings(deps.db, parentId);
    if (!settings.privacy[spec.privacyFlag]) throw appError(403, 'uploads_disabled');
    if (!(await getDocument(deps.db, parentId, documentId))) throw appError(404, 'document_not_synced');
    if ((await storageUsage(deps.db, parentId)) >= deps.config.uploadQuotaBytes) throw appError(413, 'quota_exceeded');
    next();
  };

  /** Stores the uploaded file and returns its record (the caller answers). */
  async function storeUpload(req: Request, spec: UploadSpec, index: number): Promise<StoredFile> {
    const files = (req.files ?? []) as Express.Multer.File[];
    const file = files[0];
    if (!file) throw appError(400, 'invalid_request');
    let moved = false;
    try {
      const parentId = parentIdOf(req);
      const documentId = parseOrThrow(IdSchema, req.params.id);
      const mime = detectMime(await readHead(file.path));
      if (!mime || !spec.mimes.has(mime)) throw appError(415, 'unsupported_file');
      // Defense in depth: the client already re-encodes photos, but a JPEG must never keep its EXIF/GPS data.
      const size = mime === 'image/jpeg' ? ((await stripJpegFile(file.path)) ?? file.size) : file.size;

      const existing = await findStoredFile(deps.db, spec.kind, parentId, documentId, index);
      const usage = await storageUsage(deps.db, parentId);
      if (usage - (existing?.size ?? 0) + size > deps.config.uploadQuotaBytes) throw appError(413, 'quota_exceeded');

      const sha256 = await sha256File(file.path);
      const storagePath = newStoragePath(parentId, documentId, `${spec.prefix}-${index}`, mime);
      await moveIntoStorage(root, file.path, storagePath);
      moved = true;
      const stored: StoredFile = {
        documentId,
        index,
        parentId,
        name: sanitizeFileName(file.originalname, `fichier-${index + 1}`),
        mime,
        size,
        sha256,
        storagePath,
        updatedAt: deps.now(),
      };
      try {
        await saveStoredFile(deps.db, spec.kind, stored);
      } catch (err) {
        await removeStored(root, storagePath);
        throw err;
      }
      if (existing && existing.storagePath !== storagePath) await removeStored(root, existing.storagePath);
      return stored;
    } finally {
      if (!moved) await removeQuietly(file.path);
    }
  }

  async function sendStored(req: Request, res: Response, kind: FileKind, index: number): Promise<void> {
    const parentId = parentIdOf(req);
    const documentId = parseOrThrow(IdSchema, req.params.id);
    if (!(await getDocument(deps.db, parentId, documentId))) throw appError(404, 'not_found');
    const stored = await findStoredFile(deps.db, kind, parentId, documentId, index);
    if (!stored) throw appError(404, 'not_found');
    const absolute = resolveStoragePath(root, stored.storagePath);
    const size = await fileSize(absolute);
    if (size === null) throw appError(404, 'not_found');

    res.status(200);
    res.setHeader('Content-Type', stored.mime);
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Disposition', attachmentDisposition(stored.name));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      await pipeline(createReadStream(absolute), res);
    } catch {
      // Client went away mid-download: nothing left to answer.
      res.destroy();
    }
  }

  router.delete('/:id', auth, unlocked, async (req, res) => {
    const parentId = parentIdOf(req);
    const id = parseOrThrow(IdSchema, req.params.id);
    const found = await withSeq(deps.db, parentId, (trx, seq) => softDeleteDocument(trx, parentId, id, deps.now(), seq));
    if (!found) throw appError(404, 'not_found');
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  // §22 « Préparer la lecture »: the page on screen from the reader, the whole document (or more pages) from the Réglages.
  const preparationLimiter = rateLimiter(deps, {
    windowMs: 15 * 60_000, limit: READING_PREPARATIONS_PER_15_MIN, key: (req) => `reading-preparation:${parentIdOf(req)}`,
  });
  router.post('/:id/reading-preparation', auth, preparationLimiter, async (req, res) => {
    const parentId = parentIdOf(req);
    const id = parseOrThrow(IdSchema, req.params.id);
    const body = parseOrThrow(ReadingPreparationRequestSchema, req.body);
    const wide = body.pageIndexes === undefined || body.pageIndexes.length > READING_PREPARATION_CHILD_MAX_PAGES;
    const until = req.auth?.parentUnlockedUntil ?? null;
    if (wide && !(until !== null && until > deps.now())) {
      sendError(req, res, 403, 'parent_locked', ERROR_MESSAGES_FR.parent_locked);
      return;
    }
    if (!(await getDocument(deps.db, parentId, id))) throw appError(404, 'not_found');
    const unavailable = await readingPreparationUnavailable(deps, parentId);
    const queued = unavailable === null ? await enqueueReadingPreparation(deps, parentId, id, { pageIndexes: body.pageIndexes, force: body.force }) : 0;
    const response: ReadingPreparationResponse = { queued, unavailable };
    res.set('Cache-Control', 'no-store').json(response);
  });

  // §17.10: « Texte écrit par un enfant » on/off. The pages whose image is on the server are read again in the new mode.
  router.put('/:id/text-mode', auth, unlocked, async (req, res) => {
    const parentId = parentIdOf(req);
    const id = parseOrThrow(IdSchema, req.params.id);
    const { textMode } = parseOrThrow(DocumentTextModeRequestSchema, req.body);
    const existing = await getDocument(deps.db, parentId, id);
    if (!existing) throw appError(404, 'not_found');
    // An EPUB has no page images to read again.
    if (existing.kind === 'epub' && textMode === 'punctuated') throw appError(400, 'invalid_request');
    const document = await withSeq(deps.db, parentId, (trx, seq) => setDocumentTextMode(trx, parentId, id, textMode, deps.now(), seq));
    if (!document) throw appError(404, 'not_found');
    // Only when the mode really changed: the pages are then read again even if they were already read in the other mode.
    let queued = 0;
    try {
      if (existing.textMode !== textMode) queued = await enqueueDocumentTranscriptions(deps, parentId, id, undefined, { reread: true });
    } catch (err) {
      deps.logger.error('worker_transcription_enqueue_failed', { error: err });
    }
    const response: DocumentTextModeResponse = { document, queued };
    res.set('Cache-Control', 'no-store').json(response);
  });

  router.post('/:id/files', auth, uploadLimiter, preflight(ORIGINAL), multerFor(ORIGINAL), async (req, res) => {
    const body = req.body as { index?: unknown } | undefined;
    const parsedIndex = FileIndexSchema.safeParse(body?.index);
    if (!parsedIndex.success) {
      for (const f of (req.files ?? []) as Express.Multer.File[]) await removeQuietly(f.path);
      throw appError(400, 'invalid_request');
    }
    await storeUpload(req, ORIGINAL, parsedIndex.data);
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  router.get('/:id/files/:index', auth, async (req, res) => {
    await sendStored(req, res, 'original', parseOrThrow(FileIndexSchema, req.params.index));
  });

  router.put('/:id/pages/:pageIndex/image', auth, uploadLimiter, preflight(PAGE_IMAGE), multerFor(PAGE_IMAGE), async (req, res) => {
    const parsedIndex = PageIndexParamSchema.safeParse(req.params.pageIndex);
    if (!parsedIndex.success) {
      for (const f of (req.files ?? []) as Express.Multer.File[]) await removeQuietly(f.path);
      throw appError(400, 'invalid_request');
    }
    const stored = await storeUpload(req, PAGE_IMAGE, parsedIndex.data);
    // §17.5: « lecture intelligente » of the new image by the external worker. Never fails the upload.
    try {
      await enqueuePageTranscription(deps, {
        parentId: stored.parentId, documentId: stored.documentId, pageIndex: stored.index, imageSha256: stored.sha256,
      });
    } catch (err) {
      deps.logger.error('worker_transcription_enqueue_failed', { error: err });
    }
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  router.get('/:id/pages/:pageIndex/image', auth, async (req, res) => {
    await sendStored(req, res, 'page_image', parseOrThrow(PageIndexParamSchema, req.params.pageIndex));
  });

  return router;
}
