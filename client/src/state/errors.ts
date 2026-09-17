import { ApiError } from '../api/http';
import { errors } from '../i18n/fr/errors';
import { useSessionStore } from './session';

type ErrorCode = keyof typeof errors.codes;

const CLIENT_CODES: ReadonlySet<string> = new Set(['offline', 'timeout', 'aborted', 'http_error', 'invalid_response']);

function knownCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(errors.codes, code);
}

/** Error code of any thrown value (`unknown` when it is not an ApiError). */
export function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : 'unknown';
}

/**
 * French message for the parent: known codes use fr.errors; unknown server codes use the server message (French by
 * contract); anything else gets the generic message.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return errors.generic;
  if (knownCode(error.code)) return errors.codes[error.code];
  if (!CLIENT_CODES.has(error.code) && error.status > 0 && error.message.trim() !== '') return error.message;
  return errors.generic;
}

/** Message for a bare error code (sync status). */
export function describeErrorCode(code: string): string {
  return knownCode(code) ? errors.codes[code] : errors.sync.unknown;
}

/** Reflects session-level API errors in the session store (locked parent area, expired session). */
export async function reportSessionError(error: unknown): Promise<void> {
  if (!(error instanceof ApiError)) return;
  const session = useSessionStore.getState();
  if (error.code === 'parent_locked') await session.markParentLocked();
  else if (error.code === 'not_authenticated') await session.markSignedOut();
}
