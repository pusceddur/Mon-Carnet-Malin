// Thin wrapper over §15.2 /api/sync.
import type { SyncRequest, SyncResponse } from '@aide/shared';
import { api } from './http';

export const postSync = (req: SyncRequest, signal?: AbortSignal): Promise<SyncResponse> =>
  api<SyncResponse>('POST', '/api/sync', req, { timeoutMs: 120_000, signal });
