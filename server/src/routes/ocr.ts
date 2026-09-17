import { LIMITS } from '@aide/shared';
import { Router, type RequestHandler, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import multer from 'multer';
import { requireAuth } from '../auth/middleware';
import { AppError, ERROR_MESSAGES_FR, errorBody } from '../errors';
import { exceedsPixelBudget, sniffImage } from '../ocr/imageInfo';
import { getSharedServerOcr } from '../ocr/instance';
import { OCR_MESSAGES_FR } from '../ocr/messages.fr';
import { OcrError, type ServerOcrLike } from '../ocr/ServerOCR';
import type { AppDeps } from '../types';

export interface OcrRouterOptions {
  /** Defaults to the process-wide tesseract.js instance. */
  ocr?: ServerOcrLike;
  rateLimitPerHour?: number;
}

function sendOcrError(res: Response, error: OcrError): void {
  switch (error.kind) {
    case 'busy':
    case 'timeout':
    case 'unavailable':
    case 'failed':
      res.set('Retry-After', String(error.retryAfterSeconds ?? 30));
      res.status(503).json(errorBody(`ocr_${error.kind}`, OCR_MESSAGES_FR[error.kind]));
      return;
    case 'invalid_image':
      res.status(422).json(errorBody('invalid_image', OCR_MESSAGES_FR.invalid_image));
      return;
    case 'aborted':
      // The client left: nothing useful to send.
      if (!res.headersSent) res.status(499).end();
      return;
  }
}

/** Multer with errors mapped to the API error format (413 for size, 400 otherwise). */
function singleImageUpload(): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LIMITS.ocrImageMaxBytes, files: 1, fields: 10, parts: 11, fieldSize: 1024 },
  }).single('image');
  return (req, res, next) => {
    upload(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(413, 'payload_too_large', ERROR_MESSAGES_FR.payload_too_large));
        return;
      }
      next(new AppError(400, 'invalid_request', ERROR_MESSAGES_FR.invalid_request));
    });
  };
}

/** Mounted by app.ts at `/api/ocr`: POST multipart `image` → OcrServerResult. The image is never stored. */
export function createOcrRouter(deps: AppDeps, options: OcrRouterOptions = {}): Router {
  const ocr = options.ocr ?? getSharedServerOcr(deps);
  const router = Router();

  const rejectWhenBusy: RequestHandler = (_req, res, next) => {
    const { available, busy } = ocr.status();
    if (!available) {
      sendOcrError(res, new OcrError('unavailable', ocr.retryAfterSeconds()));
      return;
    }
    if (busy) {
      sendOcrError(res, new OcrError('busy', ocr.retryAfterSeconds()));
      return;
    }
    next();
  };

  const limiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: options.rateLimitPerHour ?? 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => (req.auth ? `parent:${req.auth.userId}` : ipKeyGenerator(req.ip ?? '')),
    handler: (_req, res) => {
      res.status(429).json(errorBody('rate_limited', ERROR_MESSAGES_FR.rate_limited));
    },
  });

  router.post('/', requireAuth(deps), rejectWhenBusy, limiter, singleImageUpload(), async (req, res) => {
    const file = req.file;
    if (!file || file.buffer.length === 0) {
      res.status(400).json(errorBody('missing_image', OCR_MESSAGES_FR.missing_image));
      return;
    }
    const info = sniffImage(file.buffer);
    if (!info) {
      res.status(415).json(errorBody('unsupported_image', OCR_MESSAGES_FR.unsupported_image));
      return;
    }
    if (exceedsPixelBudget(info)) {
      res.status(413).json(errorBody('image_too_large', OCR_MESSAGES_FR.image_too_large));
      return;
    }

    const controller = new AbortController();
    const onClose = (): void => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', onClose);
    try {
      const result = await ocr.recognize(file.buffer, { signal: controller.signal });
      res.set('Cache-Control', 'no-store').json(result);
    } catch (error) {
      if (!(error instanceof OcrError)) throw error;
      sendOcrError(res, error);
    } finally {
      res.off('close', onClose);
    }
  });

  return router;
}
