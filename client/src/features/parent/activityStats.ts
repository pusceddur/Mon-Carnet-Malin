import type { ActivitySummary, Id, Millis } from '@aide/shared';

export type ActivityPeriod = 'week' | 'month' | 'calendarMonth';

export interface ActivityStats {
  sessionCount: number;
  readingMs: number;
  /** Distinct pages (document + page) viewed over the period. */
  pagesRead: number;
  wordsLookedUp: number;
  ttsSeconds: number;
  ai: { total: number; cacheHits: number; byStatus: { status: string; count: number }[] };
  unseenAlerts: number;
  /**
   * spentEur: AI paid per use (the level and the pause depend on it only). §21 estimateEur: home computer, estimated at list
   * prices; totalEur = both, shown against the budget; estimateOver: the total is beyond the budget without any pause.
   */
  budget: {
    spentEur: number; estimateEur: number; totalEur: number; budgetEur: number; percent: number;
    level: 'ok' | 'warning' | 'reached'; estimateOver: boolean;
  };
}

const DAY_MS = 24 * 60 * 60_000;
/** A session longer than this is an app left open, not reading. */
const MAX_SESSION_MS = 4 * 60 * 60_000;
const STATUS_ORDER = ['ok', 'not_in_text', 'blocked', 'unavailable', 'pending', 'error'];

/** [from, to] in epoch ms for a period ending now (calendar month in local time). */
export function periodRange(period: ActivityPeriod, now: Millis): { from: Millis; to: Millis } {
  if (period === 'calendarMonth') {
    const d = new Date(now);
    return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: now };
  }
  return { from: now - (period === 'week' ? 7 : 30) * DAY_MS, to: now };
}

export function computeActivityStats(summary: ActivitySummary, childId: Id | null = null): ActivityStats {
  const sessions = summary.sessions.filter((s) => childId === null || s.childId === childId);
  const pages = new Set<string>();
  let readingMs = 0;
  let wordsLookedUp = 0;
  let ttsSeconds = 0;
  for (const s of sessions) {
    readingMs += Math.min(MAX_SESSION_MS, Math.max(0, s.endedAt - s.startedAt));
    wordsLookedUp += Math.max(0, s.wordsLookedUp);
    ttsSeconds += Math.max(0, s.ttsSeconds);
    for (const p of s.pagesViewed) pages.add(`${s.documentId}:${p}`);
  }

  const requests = summary.aiRequests.filter((r) => childId === null || r.childId === childId);
  const counts = new Map<string, number>();
  for (const r of requests) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const rank = (status: string): number => {
    const i = STATUS_ORDER.indexOf(status);
    return i === -1 ? STATUS_ORDER.length : i;
  };
  const byStatus = Array.from(counts, ([status, count]) => ({ status, count }))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.status.localeCompare(b.status));

  const spentEur = Math.max(0, summary.budget.monthToDateEur);
  const estimateEur = Math.max(0, summary.budget.workerEstimateEur);
  const totalEur = spentEur + estimateEur;
  const budgetEur = Math.max(0, summary.budget.monthlyBudgetEur);
  const ratioOf = (value: number): number => (budgetEur > 0 ? value / budgetEur : value > 0 ? 1 : 0);
  const ratio = ratioOf(spentEur);
  const level = ratio >= 1 ? 'reached' : ratio >= 0.8 ? 'warning' : 'ok';

  return {
    sessionCount: sessions.length,
    readingMs,
    pagesRead: pages.size,
    wordsLookedUp,
    ttsSeconds,
    ai: { total: requests.length, cacheHits: requests.filter((r) => r.cacheHit).length, byStatus },
    unseenAlerts: summary.alerts.filter((a) => a.seenAt === null && (childId === null || a.childId === childId || a.childId === null)).length,
    budget: {
      spentEur, estimateEur, totalEur, budgetEur, percent: Math.round(Math.min(1, ratioOf(totalEur)) * 100), level,
      estimateOver: level !== 'reached' && estimateEur > 0 && ratioOf(totalEur) >= 1,
    },
  };
}

/** Unseen alerts first, newest first. */
export function sortAlerts<T extends { createdAt: Millis; seenAt: Millis | null }>(alerts: readonly T[]): T[] {
  return [...alerts].sort((a, b) => Number(a.seenAt !== null) - Number(b.seenAt !== null) || b.createdAt - a.createdAt);
}
