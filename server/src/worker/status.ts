// GET /api/settings/worker (§17.5): state of the external worker as seen by a parent. Read from the database (not cached).
import type { WorkerStatus } from '@aide/shared';
import { countActiveWorkerJobs, listWorkerStates } from '../db/repositories/workerJobs';
import type { AppDeps } from '../types';
import { presenceOf } from './runtime';

export async function workerStatusFor(deps: Pick<AppDeps, 'db' | 'config' | 'now'>, parentId: string): Promise<WorkerStatus> {
  const configured = deps.config.worker.tokenSha256 !== null;
  const [states, queued] = await Promise.all([listWorkerStates(deps.db), countActiveWorkerJobs(deps.db, parentId)]);
  const presence = presenceOf(configured ? states : [], deps.now());
  return {
    configured,
    connected: presence.connected,
    lastSeenAt: presence.lastSeenAt,
    limited: presence.limited,
    limitResetsAt: presence.limitResetsAt,
    queued,
  };
}
