import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@aide/shared';
import { z } from 'zod';
import type { Logger } from './logger';

/** Error with an HTTP status, a stable machine code and a French message safe to show. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly messageFr: string;

  constructor(status: number, code: string, messageFr: string) {
    super(`${code}: ${messageFr}`);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.messageFr = messageFr;
  }
}

export const ERROR_MESSAGES_FR = {
  invalid_request: 'La requête est invalide.',
  invalid_json: 'Le contenu envoyé est illisible.',
  payload_too_large: 'Le fichier ou le contenu envoyé est trop volumineux.',
  not_found: 'Ressource introuvable.',
  not_authenticated: 'Tu dois te connecter.',
  parent_locked: "L'espace parent est verrouillé.",
  forbidden: 'Action non autorisée.',
  rate_limited: 'Trop de tentatives. Réessaie plus tard.',
  not_implemented: 'Fonction pas encore disponible.',
  internal_error: 'Une erreur est survenue. Réessaie plus tard.',
} as const;

export function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

/** Parses `data` with a zod schema or throws a 400 `invalid_request` AppError. */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new AppError(400, 'invalid_request', ERROR_MESSAGES_FR.invalid_request);
  return result.data;
}

/** 404 JSON handler (mounted under /api). */
export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json(errorBody('not_found', ERROR_MESSAGES_FR.not_found));
};

interface HttpLikeError { status?: unknown; statusCode?: unknown; type?: unknown; code?: unknown }

/** Final error handler: always answers with ApiErrorBody, never leaks internals. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json(errorBody(err.code, err.messageFr));
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json(errorBody('invalid_request', ERROR_MESSAGES_FR.invalid_request));
      return;
    }
    const e = (typeof err === 'object' && err !== null ? err : {}) as HttpLikeError;
    if (e.type === 'entity.too.large' || e.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json(errorBody('payload_too_large', ERROR_MESSAGES_FR.payload_too_large));
      return;
    }
    if (e.type === 'entity.parse.failed') {
      res.status(400).json(errorBody('invalid_json', ERROR_MESSAGES_FR.invalid_json));
      return;
    }
    const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : 500;
    if (status >= 400 && status < 500) {
      res.status(status).json(errorBody('invalid_request', ERROR_MESSAGES_FR.invalid_request));
      return;
    }
    logger.error('unhandled_error', { method: req.method, path: req.path, error: err });
    res.status(500).json(errorBody('internal_error', ERROR_MESSAGES_FR.internal_error));
  };
}
