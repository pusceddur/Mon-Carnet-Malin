import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATION_NAMES, runMigrations } from '../../src/db/knex';
import { WORKER_TABLES } from '../../src/db/migrations/004_worker_jobs';
import { RETENTION, runRetention, startMaintenance } from '../../src/maintenance/retention';
import { silentLogger } from '../../src/logger';
import { uploadsDir } from '../../src/paths';
import { type TestContext, unlock, XRW } from '../platform/helpers';
import { createWorkerContext, jobRow, parentWithDocument, queueAiJob } from './helpers';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

describe('worker queue: migration and retention (§17.2)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createWorkerContext();
  });
  afterEach(async () => ctx.close());

  it('migration 004 is bundled after 003 and creates the worker tables (idempotent)', async () => {
    expect(MIGRATION_NAMES).toEqual(['001_initial', '002_invitations', '003_client_diagnostics', '004_worker_jobs']);
    for (const table of WORKER_TABLES) expect(await ctx.db.schema.hasTable(table), table).toBe(true);
    expect(await runMigrations(ctx.db)).toEqual([]);
  });

  it('expires overdue queued jobs, deletes concluded ai rows after 1 h and other concluded rows after 7 days', async () => {
    const { parentId } = await parentWithDocument(ctx, 'retention@example.fr');
    const now = ctx.clock.now;
    const setState = (id: string, status: string, updatedAt: number) => ctx.db('worker_jobs').where('id', id).update({ status, updated_at: updatedAt });

    const overdue = await queueAiJob(ctx, parentId, { expiresAt: now - 1 });
    const waiting = await queueAiJob(ctx, parentId, { expiresAt: now + HOUR });
    const leased = await queueAiJob(ctx, parentId, { expiresAt: now + HOUR });
    await setState(leased, 'leased', now - 2 * HOUR);
    const oldAi = await queueAiJob(ctx, parentId);
    await setState(oldAi, 'done', now - RETENTION.workerAiJobsMs - 1);
    const recentAi = await queueAiJob(ctx, parentId);
    await setState(recentAi, 'failed', now - RETENTION.workerAiJobsMs + 60_000);
    const oldPage = await queueAiJob(ctx, parentId, { kind: 'page_text', operation: 'transcribe_page' });
    await setState(oldPage, 'skipped', now - RETENTION.workerJobsMs - 1);
    const recentPage = await queueAiJob(ctx, parentId, { kind: 'page_text', operation: 'transcribe_page' });
    await setState(recentPage, 'done', now - 6 * DAY);

    const report = await runRetention({ db: ctx.db, now, uploadsRoot: uploadsDir(ctx.config) });
    expect(report).toMatchObject({ expiredWorkerJobs: 1, workerJobs: 2 });
    expect(await jobRow(ctx, overdue)).toMatchObject({ status: 'expired', request_json: '{}' });
    expect(await jobRow(ctx, waiting)).toMatchObject({ status: 'queued' });
    expect(await jobRow(ctx, leased)).toMatchObject({ status: 'leased' });
    expect(await jobRow(ctx, oldAi)).toBeUndefined();
    expect(await jobRow(ctx, recentAi)).toMatchObject({ status: 'failed' });
    expect(await jobRow(ctx, oldPage)).toBeUndefined();
    expect(await jobRow(ctx, recentPage)).toMatchObject({ status: 'done' });

    // One hour later: the expired ai row is deleted, and the job that was still waiting is now overdue.
    const later = await runRetention({ db: ctx.db, now: now + HOUR + 1, uploadsRoot: uploadsDir(ctx.config) });
    expect(later).toMatchObject({ expiredWorkerJobs: 1 });
    expect(await jobRow(ctx, overdue)).toBeUndefined();
    expect(await jobRow(ctx, waiting)).toMatchObject({ status: 'expired' });
  });

  it('a purged document takes its worker jobs with it', async () => {
    const { parentId, agent, documentId } = await parentWithDocument(ctx, 'purge@example.fr');
    const other = await parentWithDocument(ctx, 'garde@example.fr');
    const pageJob = { kind: 'page_text' as const, operation: 'transcribe_page', pageIndex: 0, expiresAt: ctx.clock.now + 90 * DAY };
    const job = await queueAiJob(ctx, parentId, { ...pageJob, documentId });
    const kept = await queueAiJob(ctx, other.parentId, { ...pageJob, documentId: other.documentId });
    await unlock(agent);
    expect((await agent.delete(`/api/documents/${documentId}`).set(XRW).send()).status).toBe(200);
    ctx.advance(RETENTION.deletedDocumentsMs + DAY);
    const report = await runRetention({ db: ctx.db, now: ctx.clock.now, uploadsRoot: uploadsDir(ctx.config) });
    expect(report).toMatchObject({ purgedDocuments: 1, workerJobs: 1 });
    expect(await jobRow(ctx, job)).toBeUndefined();
    expect(await jobRow(ctx, kept)).toMatchObject({ status: 'queued' });
  });

  it('the hourly worker pass cleans concluded ai rows between the daily runs', async () => {
    const { parentId } = await parentWithDocument(ctx, 'horaire@example.fr');
    const lines: string[] = [];
    const logger = { ...silentLogger, info: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
    const stop = startMaintenance({ db: ctx.db, now: () => ctx.clock.now, uploadsRoot: uploadsDir(ctx.config), logger, intervalMs: 3_600_000, workerIntervalMs: 50 });
    await expect.poll(() => lines).toContain('maintenance_done');
    const old = await queueAiJob(ctx, parentId);
    await ctx.db('worker_jobs').where('id', old).update({ status: 'done', updated_at: ctx.clock.now - 2 * HOUR });
    await expect.poll(async () => jobRow(ctx, old)).toBeUndefined();
    expect(lines).toContain('worker_maintenance_done');
    stop();
  });
});
