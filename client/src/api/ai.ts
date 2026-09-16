// STUB: client-reader — thin wrappers over §7 /api/ai (use ai/aiClient.ts from the UI, never these directly)
import type { AIOperation, AIResult, DataFor, HandwritingRequest, HandwritingResult, RequestFor } from '@aide/shared';
import { api } from './http';

export function postAI<Op extends AIOperation>(op: Op, body: RequestFor<Op>, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<AIResult<DataFor<Op>>> {
  return api<AIResult<DataFor<Op>>>('POST', `/api/ai/${op}`, body, opts);
}

export const postHandwriting = (body: HandwritingRequest, signal?: AbortSignal): Promise<HandwritingResult> =>
  api<HandwritingResult>('POST', '/api/ai/handwriting', body, { signal, timeoutMs: 45_000 });
