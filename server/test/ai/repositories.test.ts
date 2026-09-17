import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@aide/shared';
import { createDb, runMigrations } from '../../src/db/knex';
import { createAICacheRepository } from '../../src/db/repositories/aiCache';
import { createAIJobsRepository } from '../../src/db/repositories/aiJobs';
import { createAIRequestsRepository, type AIRequestRecord } from '../../src/db/repositories/aiRequests';
import { createSafetyAlertsRepository } from '../../src/db/repositories/safetyAlerts';

let db: Knex;
const T0 = Date.UTC(2026, 8, 16, 10, 0, 0);

beforeEach(async () => {
  db = createDb('sqlite::memory:');
  await runMigrations(db);
});

afterEach(async () => {
  await db.destroy();
});

function record(overrides: Partial<AIRequestRecord> = {}): AIRequestRecord {
  return {
    id: newId(), parentId: 'p1', childId: 'c1', documentId: null, operation: 'explain_text', route: 'light', provider: 'plugin', model: 'modele',
    promptVersion: 'v1', cacheHit: false, status: 'ok', rejectionReason: null, rejectionDetail: null, inputChars: 10, inputTokens: 5,
    outputTokens: 7, costMicros: 1000, readabilityWarning: false, durationMs: 42, createdAt: T0, ...overrides,
  };
}

describe('ai_cache repository', () => {
  it('stores, upserts on the cache key and honours expiry', async () => {
    const repo = createAICacheRepository(db);
    const entry = {
      cacheKey: 'k'.repeat(64), operation: 'explain_text' as const, provider: 'plugin', model: 'm1', promptVersion: 'v1', inputHash: 'i'.repeat(64),
      documentHash: null, contentHash: null, output: { status: 'ok', data: { explanation: 'a' } }, validationStatus: 'ok' as const, createdAt: T0, expiresAt: T0 + 1000,
    };
    await repo.put(entry);
    await repo.put({ ...entry, model: 'm2', output: { status: 'ok', data: { explanation: 'b' } } });
    expect(await db('ai_cache').count({ n: '*' }).first()).toMatchObject({ n: 1 });
    expect(await repo.get(entry.cacheKey, T0 + 10)).toMatchObject({ model: 'm2', output: { data: { explanation: 'b' } } });
    expect(await repo.get(entry.cacheKey, T0 + 1000)).toBeNull();
    expect(await repo.get('x'.repeat(64), T0)).toBeNull();
  });
});

describe('ai_requests repository', () => {
  it('counts only billable calls of the child and sums the costs of the parent', async () => {
    const repo = createAIRequestsRepository(db);
    await repo.insert(record());
    await repo.insert(record({ cacheHit: true }));
    await repo.insert(record({ provider: 'local', costMicros: null }));
    await repo.insert(record({ provider: 'none', costMicros: null, status: 'unavailable', rejectionReason: 'quota' }));
    await repo.insert(record({ childId: 'c2', costMicros: 5000 }));
    await repo.insert(record({ createdAt: T0 - 86_400_000, costMicros: 100_000 }));
    expect(await repo.countBillableCalls('c1', T0 - 1000)).toBe(1);
    expect(await repo.sumCostMicros('p1', T0 - 1000)).toBe(7000);
    expect(await repo.sumCostMicros('p2', 0)).toBe(0);
    const row = await db('ai_requests').where('child_id', 'c2').first();
    expect(row).toMatchObject({ provider: 'plugin', cost_micros: 5000, duration_ms: 42 });
  });
});

describe('safety_alerts repository', () => {
  it('deduplicates by parent, kind and detail (optionally within a period)', async () => {
    const repo = createSafetyAlertsRepository(db);
    const alert = { parentId: 'p1', childId: 'c1', documentId: null, kind: 'injection_detected' as const, detail: 'Consignes suspectes.', createdAt: T0 };
    expect(await repo.insertOnce(alert)).toBe(true);
    expect(await repo.insertOnce({ ...alert, createdAt: T0 + 5 })).toBe(false);
    expect(await repo.insertOnce({ ...alert, parentId: 'p2' })).toBe(true);
    expect(await repo.insertOnce({ ...alert, kind: 'budget_warning', detail: 'Budget', dedupSince: T0 })).toBe(true);
    expect(await repo.insertOnce({ ...alert, kind: 'budget_warning', detail: 'Budget', createdAt: T0 + 40 * 86_400_000, dedupSince: T0 + 31 * 86_400_000 })).toBe(true);
    expect(await repo.existsSince('p1', 'budget_warning', T0 + 1)).toBe(true);
    expect(await repo.existsSince('p1', 'adult_redirect', 0)).toBe(false);
    expect(await db('safety_alerts').whereNull('seen_at').count({ n: '*' }).first()).toMatchObject({ n: 4 });
  });
});

describe('ai_jobs repository', () => {
  it('creates, completes and isolates jobs per parent with expiry', async () => {
    const repo = createAIJobsRepository(db);
    const id = newId();
    await repo.create({ id, parentId: 'p1', childId: 'c1', operation: 'generate_questions', status: 'pending', result: null, createdAt: T0, expiresAt: T0 + 3_600_000 });
    expect(await repo.get('p1', id, T0)).toMatchObject({ status: 'pending', result: null });
    expect(await repo.get('p2', id, T0)).toBeNull();
    await repo.complete(id, 'done', { status: 'ok', data: { questions: [] } }, T0 + 50);
    expect(await repo.get('p1', id, T0 + 60)).toMatchObject({ status: 'done', updatedAt: T0 + 50, result: { status: 'ok' } });
    expect(await repo.get('p1', id, T0 + 3_600_000)).toBeNull();
  });

  it('keeps the deadline of a pending job (stale check) without exposing it as a result', async () => {
    const repo = createAIJobsRepository(db);
    const id = newId();
    await repo.create({ id, parentId: 'p1', childId: 'c1', operation: 'explain_text', status: 'pending', result: null, createdAt: T0, expiresAt: T0 + 3_600_000, deadlineMs: 90_000 });
    expect(await repo.get('p1', id, T0)).toMatchObject({ status: 'pending', result: null, deadlineMs: 90_000 });
    await repo.complete(id, 'done', { status: 'ok' }, T0 + 10);
    expect(await repo.get('p1', id, T0 + 20)).toMatchObject({ status: 'done', result: { status: 'ok' }, deadlineMs: null });
  });
});
