import { type DocumentMeta, newId, type PageContent } from '@aide/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PUNCTUATED_TRANSCRIPTION_OPERATION, PUNCTUATED_TRANSCRIPTION_SYSTEM_PROMPT, PUNCTUATED_TRANSCRIPTION_USER_TEXT, TRANSCRIPTION_OPERATION,
  TRANSCRIPTION_SYSTEM_PROMPT,
} from '../../src/worker/pageTranscription';
import { type Agent, createTestContext, makeDocument, pullAll, sync, type TestContext, unlock, XRW } from '../platform/helpers';
import { createWorkerContext, doneBody, jobRow, lease, parentWithDocument, postResult, uploadPageImage } from './helpers';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

const AWAITING: Partial<PageContent> = { pageIndex: 0, status: 'failed', textSource: null, blocks: [], contentHash: null, confidence: null, warnings: ['awaiting_ai'] };
const TYPED = 'hier je suis allé au parc avec mon chien il a couru partout';
const PDF_TEXT: Partial<PageContent> = { pageIndex: 0, status: 'ready', textSource: 'pdf-text', confidence: null, warnings: [], blocks: [{ kind: 'paragraph', text: TYPED }] };
const FAITHFUL = { status: 'ok', blocks: [{ kind: 'paragraph', text: TYPED }] };
const PUNCTUATED = { status: 'ok', blocks: [{ kind: 'paragraph', text: 'Hier, je suis allé au parc avec mon chien. Il a couru partout !' }] };
const INVENTED = { status: 'ok', blocks: [{ kind: 'paragraph', text: 'Il était une fois un dragon qui vivait dans un château magnifique au sommet des nuages.' }] };

async function pageJobs(c: TestContext, documentId: string): Promise<Record<string, unknown>[]> {
  return c.db('worker_jobs').where({ document_id: documentId, page_index: 0 }).orderBy('created_at').orderBy('id');
}

async function currentPage(agent: Agent, documentId: string): Promise<PageContent | undefined> {
  const { pages } = await pullAll(agent);
  return pages.flatMap((p) => p.changes.pages).filter((p) => p.documentId === documentId && p.pageIndex === 0).at(-1);
}

function setTextMode(agent: Agent, documentId: string, textMode: string) {
  return agent.put(`/api/documents/${documentId}/text-mode`).set(XRW).send({ textMode });
}

describe('texte écrit par un enfant — lecture intelligente (§17.10)', () => {
  it('queues the punctuation prompt, even over a PDF text layer; a book PDF and a correction by hand are never read again', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const child = await parentWithDocument(c, 'enfant@example.fr', [PDF_TEXT], { kind: 'pdf', textMode: 'punctuated' });
    expect((await uploadPageImage(child.agent, child.documentId, 0)).status).toBe(200);
    const jobs = await pageJobs(c, child.documentId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'page_text', operation: PUNCTUATED_TRANSCRIPTION_OPERATION, status: 'queued' });
    const request = JSON.parse(String(jobs[0]!.request_json));
    expect(request).toMatchObject({ system: PUNCTUATED_TRANSCRIPTION_SYSTEM_PROMPT, userText: PUNCTUATED_TRANSCRIPTION_USER_TEXT, documentText: null });
    expect(request.userText).toContain("fautes d'orthographe comprises");

    const book = await parentWithDocument(c, 'livre@example.fr', [PDF_TEXT], { kind: 'pdf' });
    expect((await uploadPageImage(book.agent, book.documentId, 0)).status).toBe(200);
    expect(await pageJobs(c, book.documentId)).toHaveLength(0);

    const corrected = await parentWithDocument(
      c, 'corrige@example.fr', [{ ...PDF_TEXT, textSource: 'manual', warnings: ['manually_corrected'] }], { textMode: 'punctuated' },
    );
    expect((await uploadPageImage(corrected.agent, corrected.documentId, 0)).status).toBe(200);
    expect(await pageJobs(c, corrected.documentId)).toHaveLength(0);
  });

  it('the worker gets the punctuation prompt; the result replaces the PDF text when it keeps the words, invented words are refused', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const { agent, documentId } = await parentWithDocument(c, 'ponctue@example.fr', [PDF_TEXT], { kind: 'pdf', textMode: 'punctuated' });
    expect((await uploadPageImage(agent, documentId, 0)).status).toBe(200);
    const job = await lease(c);
    expect(job).toMatchObject({ kind: 'page_text', operation: PUNCTUATED_TRANSCRIPTION_OPERATION, system: PUNCTUATED_TRANSCRIPTION_SYSTEM_PROMPT });
    expect((await postResult(c, job!.id, doneBody(PUNCTUATED))).body).toEqual({ ok: true, applied: true });
    expect(await currentPage(agent, documentId)).toMatchObject({ status: 'ready', textSource: 'ocr-ai', blocks: PUNCTUATED.blocks });

    const other = await parentWithDocument(c, 'invente@example.fr', [PDF_TEXT], { kind: 'pdf', textMode: 'punctuated' });
    expect((await uploadPageImage(other.agent, other.documentId, 0)).status).toBe(200);
    const second = await lease(c);
    expect((await postResult(c, second!.id, doneBody(INVENTED))).body).toEqual({ ok: true, applied: false });
    expect(await jobRow(c, second!.id)).toMatchObject({ status: 'skipped', error: 'mismatch' });
    expect(await currentPage(other.agent, other.documentId)).toMatchObject({ textSource: 'pdf-text', blocks: PDF_TEXT.blocks });
  });
});

describe('PUT /api/documents/:id/text-mode (§17.10)', () => {
  it('needs the unlocked parent area, saves the mode for every device and reads the pages again in the new mode', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const { agent, documentId } = await parentWithDocument(c, 'mode@example.fr', [AWAITING]);
    expect((await uploadPageImage(agent, documentId, 0)).status).toBe(200);
    const first = await lease(c);
    expect(first).toMatchObject({ operation: TRANSCRIPTION_OPERATION, system: TRANSCRIPTION_SYSTEM_PROMPT });
    expect((await postResult(c, first!.id, doneBody(FAITHFUL))).body).toEqual({ ok: true, applied: true });
    const { cursor } = await pullAll(agent);

    const locked = await setTextMode(agent, documentId, 'punctuated');
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('parent_locked');

    await unlock(agent);
    c.advance(1_000);
    const res = await setTextMode(agent, documentId, 'punctuated');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ queued: 1, document: { id: documentId, textMode: 'punctuated', updatedAt: c.clock.now } });
    expect((await pageJobs(c, documentId)).map((j) => [j.operation, j.status])).toEqual([
      [TRANSCRIPTION_OPERATION, 'done'], [PUNCTUATED_TRANSCRIPTION_OPERATION, 'queued'],
    ]);
    const pulled = await sync(agent, { cursor });
    expect(pulled.changes.documents).toEqual([expect.objectContaining({ id: documentId, textMode: 'punctuated' })]);

    // Same mode again: nothing changes, nothing is queued.
    const same = await setTextMode(agent, documentId, 'punctuated');
    expect(same.body).toMatchObject({ queued: 0, document: { textMode: 'punctuated', updatedAt: c.clock.now } });

    // Back to the book mode before the worker took the page: the punctuation job is dropped, the page is read again.
    c.advance(1_000);
    const back = await setTextMode(agent, documentId, 'faithful');
    expect(back.body).toMatchObject({ queued: 1, document: { textMode: 'faithful' } });
    expect((await pageJobs(c, documentId)).map((j) => [j.operation, j.status, j.error])).toEqual([
      [TRANSCRIPTION_OPERATION, 'done', null], [PUNCTUATED_TRANSCRIPTION_OPERATION, 'skipped', 'mode_changed'], [TRANSCRIPTION_OPERATION, 'queued', null],
    ]);
  });

  it('a result read in the previous mode is not applied', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const { agent, documentId } = await parentWithDocument(c, 'ancien-mode@example.fr', [AWAITING]);
    expect((await uploadPageImage(agent, documentId, 0)).status).toBe(200);
    const job = await lease(c);
    await unlock(agent);
    expect((await setTextMode(agent, documentId, 'punctuated')).body).toMatchObject({ queued: 1 });
    expect((await postResult(c, job!.id, doneBody(FAITHFUL))).body).toEqual({ ok: true, applied: false });
    expect(await jobRow(c, job!.id)).toMatchObject({ status: 'skipped', error: 'mode_changed' });
    expect(await currentPage(agent, documentId)).toMatchObject({ status: 'failed', warnings: ['awaiting_ai'] });
  });

  it('works without a home computer; refuses EPUB punctuation, unknown modes and other parents’ documents', async () => {
    ctx = await createTestContext();
    const c = ctx;
    const { agent, documentId } = await parentWithDocument(c, 'sans-pc@example.fr', [AWAITING]);
    await unlock(agent);
    expect((await setTextMode(agent, documentId, 'punctuated')).body).toMatchObject({ queued: 0, document: { textMode: 'punctuated' } });
    expect((await setTextMode(agent, documentId, 'corrige')).status).toBe(400);
    expect((await agent.put(`/api/documents/${documentId}/text-mode`).set(XRW).send({ textMode: 'faithful', extra: 1 })).status).toBe(400);
    expect((await agent.put(`/api/documents/${newId()}/text-mode`).set(XRW).send({ textMode: 'faithful' })).status).toBe(404);

    const epub = await parentWithDocument(c, 'epub@example.fr', [], { kind: 'epub' });
    await unlock(epub.agent);
    expect((await setTextMode(epub.agent, epub.documentId, 'punctuated')).status).toBe(400);
    expect((await setTextMode(epub.agent, epub.documentId, 'faithful')).status).toBe(200);
    expect((await setTextMode(epub.agent, documentId, 'faithful')).status).toBe(404);
  });

  it('a sync push sets the mode of a new document but never changes it afterwards', async () => {
    ctx = await createTestContext();
    const c = ctx;
    const { agent, documentId, parentId } = await parentWithDocument(c, 'push@example.fr');
    const edited = makeDocument(parentId, { id: documentId, kind: 'images', textMode: 'punctuated', title: 'Nouveau titre', updatedAt: c.clock.now + 1 });
    expect((await sync(agent, { changes: { documents: [edited] } })).rejected).toEqual([]);
    expect(await c.db('documents').where('id', documentId).first()).toMatchObject({ title: 'Nouveau titre', text_mode: 'faithful' });

    const created = makeDocument(parentId, { kind: 'images', textMode: 'punctuated' });
    expect((await sync(agent, { changes: { documents: [created] } })).rejected).toEqual([]);
    expect(await c.db('documents').where('id', created.id).first()).toMatchObject({ text_mode: 'punctuated' });
    // A device that does not know text modes yet.
    const { textMode: _unknown, ...older } = makeDocument(parentId);
    expect((await sync(agent, { changes: { documents: [older as DocumentMeta] } })).rejected).toEqual([]);
    expect(await c.db('documents').where('id', older.id).first()).toMatchObject({ text_mode: 'faithful' });
  });
});
