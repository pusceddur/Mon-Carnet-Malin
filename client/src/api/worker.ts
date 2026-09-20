// Thin wrapper over §17.5 POST /api/worker/transcriptions (parent session, unlocked area).
import type { Id } from '@aide/shared';
import { ApiError, api } from './http';

export interface RelaunchTranscriptionResponse { queued: number }

/**
 * Sends the pages whose image is on the server to the « lecture intelligente » again (all pages when `pageIndexes` is
 * absent). Resolves with the number of queued pages. Throws ApiError (`parent_locked`, `offline`, …).
 */
export async function relaunchTranscription(
  documentId: Id, pageIndexes?: number[], opts: { reread?: boolean } = {},
): Promise<RelaunchTranscriptionResponse> {
  const body: { documentId: Id; pageIndexes?: number[]; reread?: boolean } = { documentId };
  if (pageIndexes !== undefined) body.pageIndexes = pageIndexes;
  // « Relancer la lecture intelligente » of a page: also when the same image was already read (§25).
  if (opts.reread) body.reread = true;
  const raw = await api<unknown>('POST', '/api/worker/transcriptions', body);
  const queued = typeof raw === 'object' && raw !== null ? (raw as { queued?: unknown }).queued : undefined;
  if (typeof queued !== 'number' || !Number.isInteger(queued) || queued < 0) throw new ApiError(200, 'invalid_response', 'Invalid JSON response');
  return { queued };
}
