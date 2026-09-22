import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
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
  parent_locked: 'Les réglages sont verrouillés.',
  forbidden: 'Action non autorisée.',
  rate_limited: 'Trop de tentatives. Réessaie plus tard.',
  not_implemented: 'Fonction pas encore disponible.',
  internal_error: 'Une erreur est survenue. Réessaie plus tard.',
  server_starting: 'Le serveur démarre. Réessaie dans un instant.',
  // auth (§7, §15.8)
  invalid_credentials: 'E-mail ou mot de passe incorrect.',
  login_locked: 'Trop de tentatives de connexion. Réessaie dans quelques minutes.',
  invalid_password: 'Le mot de passe est incorrect.',
  invalid_pin: 'Le code PIN est incorrect.',
  pin_locked: 'Trop d’essais avec le code PIN. Réessaie dans quelques minutes.',
  pin_not_set: 'Aucun code PIN n’est défini pour ce compte.',
  setup_not_allowed: 'La première configuration a déjà été faite ou n’est pas activée.',
  // §30 « Supprimer le compte »
  account_deleted: 'Ce compte a été supprimé.',
  owner_account: 'Ce compte administre le serveur : il ne peut pas être supprimé tant que d’autres familles l’utilisent.',
  invalid_setup_token: 'Le code d’installation est incorrect.',
  email_taken: 'Cette adresse e-mail est déjà utilisée.',
  invalid_invitation: 'Le code d’invitation n’est pas valide ou les inscriptions sont fermées.',
  too_many_attempts: 'Trop de tentatives. Réessaie plus tard.',
  // account security (§20)
  invalid_token: 'Ce lien n’est plus valable. Demande un nouveau lien.',
  mail_unavailable: 'L’envoi d’e-mails n’est pas configuré sur ce serveur.',
  current_session: 'Pour cet appareil, utilise « Se déconnecter ».',
  // documents and uploads (§15.6)
  document_not_synced: 'Le document n’est pas encore synchronisé. Réessaie après la synchronisation.',
  uploads_disabled: 'L’envoi de ce fichier est désactivé dans les réglages de confidentialité.',
  unsupported_file: 'Ce type de fichier n’est pas accepté.',
  quota_exceeded: 'L’espace de stockage est plein.',
  // external worker (§17.3)
  job_not_leased: 'Cette tâche n’est plus attribuée à ce poste.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES_FR;

/** AppError with the standard French message of `code`. */
export function appError(status: number, code: ErrorCode): AppError {
  return new AppError(status, code, ERROR_MESSAGES_FR[code]);
}

export function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

/** Parses `data` with a zod schema or throws a 400 `invalid_request` AppError. */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new AppError(400, 'invalid_request', ERROR_MESSAGES_FR.invalid_request);
  return result.data;
}

/** Upper bound of an unread request body discarded before answering an error (beyond it the connection is dropped). */
export const DRAIN_MAX_BYTES = 26 * 1024 * 1024;

/**
 * Calls `done` once the request body has been fully received (or immediately when there is none).
 * Answering while a client is still uploading (auth failure before a large sync or upload body is read)
 * makes browsers report a network error instead of the status; reading the rest first avoids that.
 */
export function afterRequestBody(req: Request, done: () => void): void {
  if (req.complete || req.readableEnded || req.destroyed) {
    done();
    return;
  }
  let bytes = 0;
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    req.off('data', onData);
    req.off('end', finish);
    req.off('error', finish);
    req.off('close', finish);
    done();
  };
  const onData = (chunk: Buffer): void => {
    bytes += chunk.length;
    if (bytes > DRAIN_MAX_BYTES) {
      stopReading(req);
      finish();
    }
  };
  req.on('data', onData);
  req.once('end', finish);
  req.once('error', finish);
  req.once('close', finish);
  req.resume();
}

function stopReading(req: Request): void {
  req.pause();
  req.res?.setHeader('Connection', 'close');
}

/** Sends an ApiErrorBody after the request body has been received. */
export function sendError(req: Request, res: Response, status: number, code: string, message: string): void {
  afterRequestBody(req, () => {
    if (!res.headersSent) res.status(status).json(errorBody(code, message));
  });
}

/** 404 JSON handler (mounted under /api). */
export const notFound: RequestHandler = (req, res) => {
  sendError(req, res, 404, 'not_found', ERROR_MESSAGES_FR.not_found);
};

interface HttpLikeError { status?: unknown; statusCode?: unknown; type?: unknown; code?: unknown; name?: unknown }

function classify(err: unknown): { status: number; code: string; message: string } | null {
  if (err instanceof AppError) return { status: err.status, code: err.code, message: err.messageFr };
  if (err instanceof z.ZodError) return { status: 400, code: 'invalid_request', message: ERROR_MESSAGES_FR.invalid_request };
  const e = (typeof err === 'object' && err !== null ? err : {}) as HttpLikeError;
  if (e.type === 'entity.too.large' || e.code === 'LIMIT_FILE_SIZE') {
    return { status: 413, code: 'payload_too_large', message: ERROR_MESSAGES_FR.payload_too_large };
  }
  if (e.name === 'MulterError') return { status: 400, code: 'invalid_request', message: ERROR_MESSAGES_FR.invalid_request };
  if (e.type === 'entity.parse.failed') return { status: 400, code: 'invalid_json', message: ERROR_MESSAGES_FR.invalid_json };
  const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : 500;
  if (status >= 400 && status < 500) return { status, code: 'invalid_request', message: ERROR_MESSAGES_FR.invalid_request };
  return null;
}

/** Final error handler: always answers with ApiErrorBody, never leaks internals. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const known = classify(err);
    if (known) {
      sendError(req, res, known.status, known.code, known.message);
      return;
    }
    logger.error('unhandled_error', { method: req.method, path: req.path, error: err });
    sendError(req, res, 500, 'internal_error', ERROR_MESSAGES_FR.internal_error);
  };
}
