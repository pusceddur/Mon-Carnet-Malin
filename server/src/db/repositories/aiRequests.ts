// ai_requests: one row per AI request handled by the router (provider/model only here, never sent to the client).
import type { AIOperation, AIRoute } from '@aide/shared';
import { type Db, toNum } from './common';

export type AIRequestStatus = 'ok' | 'not_in_text' | 'blocked' | 'unavailable' | 'aborted' | 'pending';

/**
 * Providers that made a real external/mock call (quota and budget count only these, never cache hits). The home worker
 * counts too: the daily limit per child is about the child's use (§15.4, §18.2.5), its cost stays null.
 */
export const BILLABLE_PROVIDERS: readonly string[] = ['plugin', 'mock', 'worker'];

export interface AIRequestRecord {
  id: string;
  parentId: string;
  childId: string | null;
  documentId: string | null;
  operation: AIOperation;
  route: AIRoute;
  /** 'plugin' | 'mock' | 'worker' | 'local' | 'none'. */
  provider: string;
  model: string;
  promptVersion: string;
  cacheHit: boolean;
  status: AIRequestStatus;
  rejectionReason: string | null;
  rejectionDetail: string | null;
  inputChars: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
  readabilityWarning: boolean;
  durationMs: number;
  createdAt: number;
}

export interface AIRequestsRepository {
  insert(record: AIRequestRecord): Promise<void>;
  /** Real provider calls of a child since `since` (quota). */
  countBillableCalls(childId: string, since: number): Promise<number>;
  /** Sum of cost_micros of a parent since `since` (budget). */
  sumCostMicros(parentId: string, since: number): Promise<number>;
}

export function createAIRequestsRepository(db: Db): AIRequestsRepository {
  return {
    async insert(r) {
      await db('ai_requests').insert({
        id: r.id,
        parent_id: r.parentId,
        child_id: r.childId,
        document_id: r.documentId,
        operation: r.operation,
        route: r.route,
        provider: r.provider.slice(0, 16),
        model: r.model.slice(0, 100),
        prompt_version: r.promptVersion,
        cache_hit: r.cacheHit,
        status: r.status,
        rejection_reason: r.rejectionReason,
        rejection_detail: r.rejectionDetail,
        input_chars: Math.min(r.inputChars, 2_000_000_000),
        input_tokens: r.inputTokens,
        output_tokens: r.outputTokens,
        cost_micros: r.costMicros,
        readability_warning: r.readabilityWarning,
        duration_ms: Math.max(0, Math.round(r.durationMs)),
        created_at: r.createdAt,
      });
    },
    async countBillableCalls(childId, since) {
      const row = (await db('ai_requests')
        .where('child_id', childId)
        .andWhere('created_at', '>=', since)
        .andWhere('cache_hit', false)
        .whereIn('provider', [...BILLABLE_PROVIDERS])
        .count({ n: '*' })
        .first()) as { n: unknown } | undefined;
      return toNum(row?.n);
    },
    async sumCostMicros(parentId, since) {
      const row = (await db('ai_requests')
        .where('parent_id', parentId)
        .andWhere('created_at', '>=', since)
        .whereNotNull('cost_micros')
        .sum({ total: 'cost_micros' })
        .first()) as { total: unknown } | undefined;
      return toNum(row?.total);
    },
  };
}

export function createMemoryAIRequestsRepository(): AIRequestsRepository & { records: AIRequestRecord[] } {
  const records: AIRequestRecord[] = [];
  return {
    records,
    insert(record) {
      records.push({ ...record });
      return Promise.resolve();
    },
    countBillableCalls(childId, since) {
      return Promise.resolve(records.filter((r) => r.childId === childId && r.createdAt >= since && !r.cacheHit && BILLABLE_PROVIDERS.includes(r.provider)).length);
    },
    sumCostMicros(parentId, since) {
      return Promise.resolve(records.filter((r) => r.parentId === parentId && r.createdAt >= since).reduce((sum, r) => sum + (r.costMicros ?? 0), 0));
    },
  };
}
