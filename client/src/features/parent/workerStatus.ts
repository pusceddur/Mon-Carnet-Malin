// Display model of the home computer that runs the « lecture intelligente » (§17.5 GET /api/settings/worker).
import type { WorkerStatus } from '@aide/shared';
import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';
import { formatRelativeTime, formatTimeOrDateTime } from './format';

const t = parent.ai.worker;

export type WorkerTone = 'ok' | 'warn' | 'off';

export interface WorkerStatusView {
  tone: WorkerTone;
  /** « Ordinateur de la maison : connecté ». */
  text: string;
  /** Waiting pages / help requests, only the non-zero counts. */
  queued: string[];
}

function stateOf(status: WorkerStatus, now: number): { tone: WorkerTone; state: string } {
  if (!status.configured) return { tone: 'off', state: t.notConfigured };
  if (!status.connected) {
    return status.lastSeenAt === null
      ? { tone: 'off', state: t.neverSeen }
      : { tone: 'off', state: format(t.offline, { when: formatRelativeTime(status.lastSeenAt, now) }) };
  }
  if (status.limited) {
    return {
      tone: 'warn',
      state: status.limitResetsAt === null ? t.limitedNoTime : format(t.limited, { time: formatTimeOrDateTime(status.limitResetsAt, now) }),
    };
  }
  return { tone: 'ok', state: t.connected };
}

export function describeWorkerStatus(status: WorkerStatus, now: number): WorkerStatusView {
  const { tone, state } = stateOf(status, now);
  const queued: string[] = [];
  if (status.configured) {
    const { pageText, ai } = status.queued;
    if (pageText > 0) queued.push(pageText === 1 ? t.pagesOne : format(t.pagesMany, { count: pageText }));
    if (ai > 0) queued.push(ai === 1 ? t.aiOne : format(t.aiMany, { count: ai }));
  }
  return { tone, text: format(t.state, { state }), queued };
}
