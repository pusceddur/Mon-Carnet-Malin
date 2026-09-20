import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '@aide/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveStoredFile } from '../../src/db/repositories/files';
import { RETENTION, runRetention, startMaintenance } from '../../src/maintenance/retention';
import { silentLogger } from '../../src/logger';
import { uploadsDir } from '../../src/paths';
import {
  createTestContext, login, makeAnswer, makeDocument, makeExercise, makeHighlight, makePage, makeProgress, makeReadingSession, newChild,
  newParent, sync, type TestContext, unlock, XRW,
} from './helpers';

const DAY = 24 * 60 * 60_000;

async function count(ctx: TestContext, table: string, where: Record<string, unknown> = {}): Promise<number> {
  const row = await ctx.db(table).where(where).count({ n: '*' }).first();
  return Number(row?.n ?? 0);
}

describe('maintenance: retention (§15.3) and purge of deleted data', () => {
  let ctx: TestContext;
  let parentId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    parentId = (await newParent(ctx, 'menage@example.fr')).parent.id;
  });
  afterEach(async () => ctx.close());

  function aiRequestRow(createdAt: number, childId: string | null = null) {
    return {
      id: newId(), parent_id: parentId, child_id: childId, document_id: null, operation: 'explain_word', route: 'light', provider: 'local',
      model: 'local', prompt_version: 'v', cache_hit: false, status: 'ok', rejection_reason: null, rejection_detail: null, input_chars: 1,
      input_tokens: null, output_tokens: null, duration_ms: 1, cost_micros: null, readability_warning: false, created_at: createdAt,
    };
  }

  function freeQuestionRow(createdAt: number, childId = newId()) {
    return { id: newId(), parent_id: parentId, child_id: childId, question: 'Pourquoi le ciel est bleu ?', outcome: 'answered', answer_text: 'La lumière.', created_at: createdAt };
  }

  it('deletes old AI logs, seen alerts after 90 days, expired jobs, cache entries, sessions and free questions after 30 days', async () => {
    const now = ctx.clock.now;
    await ctx.db('ai_requests').insert([aiRequestRow(now - RETENTION.aiRequestsMs - 1), aiRequestRow(now - RETENTION.aiRequestsMs + DAY)]);
    const alert = (seenAt: number | null, createdAt = now - 400 * DAY) => ({
      id: newId(), parent_id: parentId, child_id: null, document_id: null, kind: 'safety_input', detail: 'x', created_at: createdAt, seen_at: seenAt,
    });
    await ctx.db('safety_alerts').insert([alert(now - 91 * DAY), alert(now - 89 * DAY), alert(null)]);
    const job = (expiresAt: number) => ({
      id: newId(), parent_id: parentId, child_id: null, operation: 'summarize', status: 'done', result_json: '{}', created_at: now - 2 * 3600_000,
      updated_at: now, expires_at: expiresAt,
    });
    await ctx.db('ai_jobs').insert([job(now - 1), job(now + 60_000)]);
    await ctx.db('ai_cache').insert({
      id: newId(), cache_key: 'c'.repeat(64), document_hash: null, content_hash: null, operation: 'explain_word', provider: 'local', model: 'm',
      prompt_version: 'v', input_hash: 'd'.repeat(64), output_json: '{}', validation_status: 'ok', created_at: now - DAY, expires_at: now - 1,
    });
    await ctx.db('sessions').update({ expires_at: now - 1 });

    await ctx.db('free_questions').insert([
      freeQuestionRow(now - RETENTION.freeQuestionsMs - 1),
      freeQuestionRow(now - RETENTION.freeQuestionsMs + DAY),
    ]);

    const report = await runRetention({ db: ctx.db, now, uploadsRoot: uploadsDir(ctx.config) });
    expect(report).toMatchObject({ aiRequests: 1, safetyAlerts: 1, aiJobs: 1, expiredAiCache: 1, sessions: 1, freeQuestions: 1 });
    expect(await count(ctx, 'ai_requests')).toBe(1);
    expect(await count(ctx, 'safety_alerts')).toBe(2); // unseen alerts are kept whatever their age
    expect(await count(ctx, 'ai_jobs')).toBe(1);
    expect(await count(ctx, 'free_questions')).toBe(1);
    expect(await runRetention({ db: ctx.db, now, uploadsRoot: uploadsDir(ctx.config) })).toMatchObject({ aiRequests: 0, safetyAlerts: 0, aiJobs: 0, freeQuestions: 0 });
  });

  it('purges a child deleted for more than 30 days with its answers, annotations, exercises and logs', async () => {
    const parentAgent = await login(ctx, 'menage@example.fr');
    const child = await newChild(parentAgent, 'Léa');
    const kept = await newChild(parentAgent, 'Tom');
    const doc = makeDocument(parentId);
    const exercise = makeExercise(child.id, doc.id);
    const res = await sync(parentAgent, {
      changes: {
        documents: [doc], exercises: [exercise, makeExercise(kept.id, doc.id)], annotations: [makeHighlight(child.id, doc.id), makeHighlight(kept.id, doc.id)],
        answers: [makeAnswer(child.id, exercise.id)], progress: [makeProgress(child.id, doc.id)], sessions: [makeReadingSession(child.id, doc.id)],
      },
    });
    expect(res.rejected).toEqual([]);
    await ctx.db('ai_requests').insert(aiRequestRow(ctx.clock.now, child.id));
    // Recent enough to survive the 30-day retention: removed by the purge of the child only.
    await ctx.db('free_questions').insert([freeQuestionRow(ctx.clock.now + 29 * DAY, child.id), freeQuestionRow(ctx.clock.now + 29 * DAY, kept.id)]);

    await unlock(parentAgent);
    expect((await parentAgent.delete(`/api/children/${child.id}`).set(XRW).send()).status).toBe(200);
    const uploadsRoot = uploadsDir(ctx.config);

    ctx.advance(RETENTION.deletedChildrenMs - DAY);
    expect((await runRetention({ db: ctx.db, now: ctx.clock.now, uploadsRoot })).purgedChildren).toBe(0);

    ctx.advance(2 * DAY);
    expect((await runRetention({ db: ctx.db, now: ctx.clock.now, uploadsRoot })).purgedChildren).toBe(1);
    for (const table of ['answers', 'annotations', 'exercises', 'reading_progress', 'reading_sessions', 'ai_requests', 'free_questions']) {
      expect(await count(ctx, table, { child_id: child.id }), table).toBe(0);
    }
    expect(await count(ctx, 'children', { id: child.id })).toBe(0);
    expect(await count(ctx, 'free_questions', { child_id: kept.id })).toBe(1);
    expect(await count(ctx, 'annotations', { child_id: kept.id })).toBe(1);
    expect(await count(ctx, 'exercises', { child_id: kept.id })).toBe(1);
  });

  it('removes files, page images and page text of documents deleted for more than 30 days', async () => {
    const parentAgent = await login(ctx, 'menage@example.fr');
    const doc = makeDocument(parentId);
    const keptDoc = makeDocument(parentId);
    await sync(parentAgent, { changes: { documents: [doc, keptDoc], pages: [makePage(doc.id), makePage(keptDoc.id)] } });

    const uploadsRoot = uploadsDir(ctx.config);
    const writeStored = async (documentId: string, kind: 'original' | 'page_image', index: number) => {
      const storagePath = `${parentId}/${documentId}/${kind}-${index}.bin`;
      mkdirSync(join(uploadsRoot, parentId, documentId), { recursive: true });
      writeFileSync(join(uploadsRoot, storagePath), 'data');
      await saveStoredFile(ctx.db, kind, {
        documentId, index, parentId, name: 'f', mime: 'image/jpeg', size: 4, sha256: 'e'.repeat(64), storagePath, updatedAt: ctx.clock.now,
      });
      return join(uploadsRoot, storagePath);
    };
    const original = await writeStored(doc.id, 'original', 0);
    const image = await writeStored(doc.id, 'page_image', 0);
    const keptFile = await writeStored(keptDoc.id, 'original', 0);

    await unlock(parentAgent);
    expect((await parentAgent.delete(`/api/documents/${doc.id}`).set(XRW).send()).status).toBe(200);
    ctx.advance(RETENTION.deletedDocumentsMs + DAY);
    const report = await runRetention({ db: ctx.db, now: ctx.clock.now, uploadsRoot });
    expect(report).toMatchObject({ purgedDocuments: 1, removedFiles: 2 });
    expect(existsSync(original)).toBe(false);
    expect(existsSync(image)).toBe(false);
    expect(existsSync(join(uploadsRoot, parentId, doc.id))).toBe(false);
    expect(existsSync(keptFile)).toBe(true);
    expect(await count(ctx, 'document_files', { document_id: doc.id })).toBe(0);
    expect(await count(ctx, 'document_page_images', { document_id: doc.id })).toBe(0);
    expect(await count(ctx, 'document_pages', { document_id: doc.id })).toBe(0);
    expect(await count(ctx, 'document_pages', { document_id: keptDoc.id })).toBe(1);
    // The document tombstone stays for devices that still have it.
    expect((await ctx.db('documents').where('id', doc.id).first()).deleted_at).not.toBeNull();
  });

  it('startMaintenance runs once immediately (then every interval) and reports through the logger', async () => {
    const lines: string[] = [];
    const logger = { ...silentLogger, info: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
    const stop = startMaintenance({ db: ctx.db, now: () => ctx.clock.now, uploadsRoot: uploadsDir(ctx.config), logger, intervalMs: 60_000 });
    await expect.poll(() => lines).toContain('maintenance_done');
    stop();
  });
});
