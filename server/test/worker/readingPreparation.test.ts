// §22 « Préparer la lecture »: pages punctuated for the voice by the external worker, the displayed text never changes.
import { DEFAULT_PARENT_SETTINGS, type PageContent, type ParentSettings } from '@aide/shared';
import type { Agent } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { findPage } from '../../src/db/repositories/pages';
import { READING_PREPARATION_OPERATION } from '../../src/worker/readingPreparation';
import { createTestContext, makePage, sync, type TestContext, unlock, XRW } from '../platform/helpers';
import { createWorkerContext, doneBody, jobRow, lease, parentWithDocument, postResult } from './helpers';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

const LIST = "Consignes 1: lis l'article 2: souligne les verbes";
const PAGES: Partial<PageContent>[] = [
  { pageIndex: 0, blocks: [{ kind: 'title', text: 'Exercices' }, { kind: 'paragraph', text: LIST }] },
  { pageIndex: 1, blocks: [{ kind: 'paragraph', text: 'Le chat dort il fait beau' }] },
  { pageIndex: 2, status: 'processing', blocks: [] },
];

function prepare(agent: Agent, documentId: string, body: Record<string, unknown> = {}) {
  return agent.post(`/api/documents/${documentId}/reading-preparation`).set(XRW).send(body);
}

async function setSettings(agent: Agent, patch: { ai?: Partial<ParentSettings['ai']>; privacy?: Partial<ParentSettings['privacy']> }): Promise<void> {
  await unlock(agent);
  const res = await agent.put('/api/settings').set(XRW).send({
    ...DEFAULT_PARENT_SETTINGS,
    ai: { ...DEFAULT_PARENT_SETTINGS.ai, ...patch.ai },
    privacy: { ...DEFAULT_PARENT_SETTINGS.privacy, ...patch.privacy },
  });
  expect(res.status).toBe(200);
}

async function pageOf(c: TestContext, documentId: string, pageIndex: number): Promise<PageContent> {
  const found = await findPage(c.db, documentId, pageIndex);
  if (!found) throw new Error('page missing');
  return found.page;
}

describe('§22 queueing', () => {
  it('the reader asks for the page on screen without the code; the whole document needs the Réglages', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const { agent, documentId } = await parentWithDocument(c, 'lecture@example.fr', PAGES);

    const page = await prepare(agent, documentId, { pageIndexes: [0] });
    expect(page.status).toBe(200);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.body).toEqual({ queued: 1, unavailable: null });
    // Same text, job waiting: nothing new.
    expect((await prepare(agent, documentId, { pageIndexes: [0] })).body).toEqual({ queued: 0, unavailable: null });

    const whole = await prepare(agent, documentId);
    expect(whole.status).toBe(403);
    expect(whole.body.error.code).toBe('parent_locked');
    expect((await prepare(agent, documentId, { pageIndexes: [0, 1, 2] })).status).toBe(403);

    await unlock(agent);
    // Page 1 only: page 0 already waits, page 2 has no text yet.
    expect((await prepare(agent, documentId)).body).toEqual({ queued: 1, unavailable: null });
    expect((await agent.get('/api/settings/worker')).body.queued).toEqual({ ai: 0, pageText: 0, pageSpeech: 2 });

    expect((await prepare(agent, '00000000-0000-4000-8000-000000000000', { pageIndexes: [0] })).status).toBe(404);
    const other = await parentWithDocument(c, 'voisin@example.fr', PAGES);
    expect((await prepare(other.agent, documentId, { pageIndexes: [0] })).status).toBe(404);
    expect((await prepare(agent, documentId, { pageIndexes: [] })).status).toBe(400);
  });

  it('says why nothing can be prepared', async () => {
    ctx = await createTestContext();
    const off = await parentWithDocument(ctx, 'sans-poste@example.fr', PAGES);
    expect((await prepare(off.agent, off.documentId, { pageIndexes: [0] })).body).toEqual({ queued: 0, unavailable: 'not_configured' });
    await ctx.close();

    ctx = await createWorkerContext();
    const noText = await parentWithDocument(ctx, 'prive@example.fr', PAGES);
    await setSettings(noText.agent, { privacy: { syncDocumentText: false } });
    expect((await prepare(noText.agent, noText.documentId, { pageIndexes: [0] })).body).toEqual({ queued: 0, unavailable: 'text_not_synced' });
    await setSettings(noText.agent, { ai: { enabled: false } });
    expect((await prepare(noText.agent, noText.documentId, { pageIndexes: [0] })).body).toEqual({ queued: 0, unavailable: 'ai_disabled' });
  });
});

describe('§22 the worker and the result', () => {
  it('goes only to a worker that knows the kind, with the numbered blocks of the page and no image', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const { agent, documentId } = await parentWithDocument(c, 'ancien@example.fr', PAGES);
    await prepare(agent, documentId, { pageIndexes: [0] });

    expect(await lease(c)).toBeNull();
    const job = await lease(c, { kinds: ['ai', 'page_text', 'page_speech'] });
    expect(job).toMatchObject({ kind: 'page_speech', tier: 'light', operation: READING_PREPARATION_OPERATION, imageUrl: null, images: [], deadlineMs: 180_000 });
    expect(JSON.parse(job!.documentText!)).toEqual({ blocks: [{ index: 1, kind: 'title', text: 'Exercices' }, { index: 2, kind: 'paragraph', text: LIST }] });
    expect(job!.userText).toContain('1: lis l\'article');
    expect(job!.jsonSchema).toMatchObject({ required: ['blocks'] });
  });

  it('stores the prepared text of each block that kept its words; the displayed text stays; every device pulls the page', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const { agent, documentId } = await parentWithDocument(c, 'resultat@example.fr', PAGES);
    await prepare(agent, documentId, { pageIndexes: [0] });
    const before = await pageOf(c, documentId, 0);
    const pulled = await sync(agent);
    const job = await lease(c, { kinds: ['page_speech'] });

    const res = await postResult(c, job!.id, doneBody({
      blocks: [
        // The title lost a word: not used.
        { index: 1, text: 'Les exercices.' },
        { index: 2, text: "Consignes.  1. Lis l'article. 2. Souligne les verbes." },
        { index: 7, text: 'Hors page.' },
      ],
    }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, applied: true });
    const after = await pageOf(c, documentId, 0);
    expect(after.blocks).toEqual([
      { kind: 'title', text: 'Exercices' },
      { kind: 'paragraph', text: LIST, spoken: "Consignes. 1. Lis l'article. 2. Souligne les verbes." },
    ]);
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    expect((await jobRow(c, job!.id))?.status).toBe('done');

    const next = await sync(agent, { cursor: pulled.cursor });
    expect(next.changes.pages.map((p) => p.blocks[1]?.spoken)).toEqual(["Consignes. 1. Lis l'article. 2. Souligne les verbes."]);
    // Prepared for this text: not queued again, unless asked.
    expect((await prepare(agent, documentId, { pageIndexes: [0] })).body.queued).toBe(0);
    expect((await prepare(agent, documentId, { pageIndexes: [0], force: true })).body.queued).toBe(1);
  });

  it('does nothing when the text changed meanwhile, or when no block kept its words', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const { agent, documentId } = await parentWithDocument(c, 'change@example.fr', PAGES);
    await prepare(agent, documentId, { pageIndexes: [0, 1] });
    // One job per worker: two workers take the two pages.
    const first = await lease(c, { kinds: ['page_speech'] });
    const second = await lease(c, { kinds: ['page_speech'], worker: 'second-pc' });

    // Page 0 corrected by hand in the meantime.
    const edited = makePage(documentId, { pageIndex: 0, textSource: 'manual', blocks: [{ kind: 'paragraph', text: 'Autre texte' }], updatedAt: c.clock.now + 60_000 });
    expect((await sync(agent, { changes: { pages: [edited] } })).rejected).toEqual([]);

    const jobs = [{ job: first!, worker: 'home-pc' }, { job: second!, worker: 'second-pc' }];
    const page0 = jobs.find((j) => JSON.parse(j.job.documentText!).blocks.length === 2)!;
    const page1 = jobs.find((j) => j !== page0)!;
    const answer0 = doneBody({ blocks: [{ index: 1, text: 'Exercices.' }, { index: 2, text: 'x' }] }, { worker: page0.worker });
    expect((await postResult(c, page0.job.id, answer0)).body.applied).toBe(false);
    expect(await jobRow(c, page0.job.id)).toMatchObject({ status: 'skipped', error: 'text_changed' });
    expect((await pageOf(c, documentId, 0)).blocks).toEqual([{ kind: 'paragraph', text: 'Autre texte' }]);

    const answer1 = doneBody({ blocks: [{ index: 1, text: 'Le chien dort.' }] }, { worker: page1.worker });
    expect((await postResult(c, page1.job.id, answer1)).body.applied).toBe(false);
    expect(await jobRow(c, page1.job.id)).toMatchObject({ status: 'skipped', error: 'mismatch' });
  });

  it('an unusable answer fails the job', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const { agent, documentId } = await parentWithDocument(c, 'invalide@example.fr', PAGES);
    await prepare(agent, documentId, { pageIndexes: [1] });
    const job = await lease(c, { kinds: ['page_speech'] });
    expect((await postResult(c, job!.id, doneBody({ status: 'ok', blocks: [] }))).status).toBe(200);
    expect(await jobRow(c, job!.id)).toMatchObject({ status: 'failed', error: 'invalid_output' });
  });

  it('a new request after a change of text replaces the waiting one', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const { agent, documentId } = await parentWithDocument(c, 'remplace@example.fr', PAGES);
    await prepare(agent, documentId, { pageIndexes: [1] });
    const edited = makePage(documentId, { pageIndex: 1, textSource: 'manual', blocks: [{ kind: 'paragraph', text: 'Le chat dort' }], updatedAt: c.clock.now + 60_000 });
    expect((await sync(agent, { changes: { pages: [edited] } })).rejected).toEqual([]);
    expect((await prepare(agent, documentId, { pageIndexes: [1] })).body.queued).toBe(1);
    const rows = (await c.db('worker_jobs').where({ kind: 'page_speech' }).orderBy('status', 'desc')) as { status: string; error: string | null }[];
    expect(rows.map((r) => [r.status, r.error])).toEqual([['skipped', 'text_changed'], ['queued', null]]);
  });
});
