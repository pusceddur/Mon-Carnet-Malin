// GET /api/settings/worker (§17.5): state of the external worker as seen by a parent. Read from the database (not cached).
// §21: plus the last use of the subscription it reported and the estimated cost of the month.
import type { SubscriptionUsage, SubscriptionWindow, WorkerStatus } from '@aide/shared';
import { monthStartUtc } from '../db/repositories/activity';
import { findUserById } from '../db/repositories/users';
import { countActiveWorkerJobs, listWorkerStates, type WorkerState } from '../db/repositories/workerJobs';
import { sumWorkerCostMicros } from '../db/repositories/workerUsage';
import type { AppDeps } from '../types';
import { presenceOf } from './runtime';

const MICROS_PER_EUR = 1_000_000;

/** The worker passes the service's own name of the window (e.g. `five_hour`, `seven_day…`); the app only needs its span. */
export function subscriptionWindowOf(rateLimitType: string | null): SubscriptionWindow | null {
  if (rateLimitType === null || rateLimitType === '') return null;
  if (rateLimitType.startsWith('five_hour')) return 'session';
  if (rateLimitType.startsWith('seven_day')) return 'week';
  return 'other';
}

/** Limits of the worker seen last (several workers: the most recent report). */
export function subscriptionUsageOf(states: readonly WorkerState[]): SubscriptionUsage | null {
  let best: { state: WorkerState; at: number } | null = null;
  for (const state of states) {
    const limits = state.info?.limits;
    if (!limits) continue;
    const at = limits.observedAt ?? state.lastSeenAt;
    if (best === null || at > best.at) best = { state, at };
  }
  const limits = best?.state.info?.limits;
  if (!best || !limits) return null;
  return {
    status: limits.status,
    window: subscriptionWindowOf(limits.rateLimitType),
    utilization: limits.utilization,
    resetsAt: limits.resetsAt,
    observedAt: limits.observedAt ?? null,
  };
}

export async function workerStatusFor(deps: Pick<AppDeps, 'db' | 'config' | 'now'>, parentId: string): Promise<WorkerStatus> {
  const configured = deps.config.worker.tokenSha256 !== null;
  const now = deps.now();
  const monthStart = monthStartUtc(now);
  const [states, queued, accountMicros, user] = await Promise.all([
    listWorkerStates(deps.db),
    countActiveWorkerJobs(deps.db, parentId),
    sumWorkerCostMicros(deps.db, parentId, monthStart),
    findUserById(deps.db, parentId),
  ]);
  const visible = configured ? states : [];
  const presence = presenceOf(visible, now);
  // The subscription serves every account of the server: its owner sees the total.
  const allMicros = user?.isOwner ? await sumWorkerCostMicros(deps.db, null, monthStart) : null;
  return {
    configured,
    connected: presence.connected,
    lastSeenAt: presence.lastSeenAt,
    limited: presence.limited,
    limitResetsAt: presence.limitResetsAt,
    queued,
    usage: subscriptionUsageOf(visible),
    estimate: {
      monthToDateEur: accountMicros / MICROS_PER_EUR,
      allAccountsEur: allMicros === null ? null : allMicros / MICROS_PER_EUR,
    },
  };
}
