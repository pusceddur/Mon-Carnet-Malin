import { type Annotation, type ChildProfile, DEFAULT_PARENT_SETTINGS, type DocumentMeta, newId, type SyncResponse, TIMINGS } from '@aide/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type Agent, createTestContext, lock, login, makeAnswer, makeDocument, makeExercise, makeHighlight, makePage, makeProgress,
  makeReadingSession, newChild, newParent, pullAll, sync, type TestContext, unlock, XRW,
} from '../platform/helpers';

const EMAIL = 'famille@example.fr';

describe('sync: push, pull, cursor', () => {
  let ctx: TestContext;
  let parentId: string;
  let deviceA: Agent;
  let deviceB: Agent;
  let child: ChildProfile;

  beforeEach(async () => {
    ctx = await createTestContext();
    const created = await newParent(ctx, EMAIL);
    parentId = created.parent.id;
    deviceA = created.agent;
    deviceB = await login(ctx, EMAIL);
    child = await newChild(deviceA);
  });
  afterEach(async () => ctx.close());

  it('requires authentication', async () => {
    const res = await request(ctx.app).post('/api/sync').set(XRW).send({ cursor: null, deviceId: 'x', changes: {} });
    expect(res.status).toBe(401);
  });

  it('pushes a document with its pages, exercises, annotations, answers, progress and sessions, and pulls them elsewhere', async () => {
    const doc = makeDocument(parentId, { childIds: [child.id] });
    const exercise = makeExercise(child.id, doc.id);
    const pushed = await sync(deviceA, {
      changes: {
        documents: [doc],
        pages: [makePage(doc.id), makePage(doc.id, { pageIndex: 1 })],
        exercises: [exercise],
        annotations: [makeHighlight(child.id, doc.id)],
        answers: [makeAnswer(child.id, exercise.id)],
        progress: [makeProgress(child.id, doc.id)],
        sessions: [makeReadingSession(child.id, doc.id)],
      },
    });
    expect(pushed.rejected).toEqual([]);
    expect(pushed.serverTime).toBe(ctx.clock.now);

    const pulled = await sync(deviceB);
    expect(pulled.hasMore).toBe(false);
    expect(pulled.changes.children.map((c) => c.id)).toEqual([child.id]);
    expect(pulled.changes.documents).toEqual([doc]);
    expect(pulled.changes.pages).toHaveLength(2);
    expect(pulled.changes.exercises).toEqual([exercise]);
    expect(pulled.changes.annotations).toHaveLength(1);
    expect(pulled.changes.answers).toHaveLength(1);
    expect(pulled.changes.progress).toEqual([makeProgress(child.id, doc.id)]);
    expect(pulled.changes.sessions).toHaveLength(1);

    const again = await sync(deviceB, { cursor: pulled.cursor });
    expect(again.cursor).toBe(pulled.cursor);
    expect(Object.values(again.changes).every((list) => list.length === 0)).toBe(true);
  });

  it('an offline edit whose timestamp is older than the other device cursor still reaches it (server_seq, not time)', async () => {
    const doc = makeDocument(parentId);
    const shared = makeHighlight(child.id, doc.id, { updatedAt: ctx.clock.now });
    const first = await sync(deviceA, { changes: { documents: [doc], annotations: [shared] } });
    let cursorB = (await sync(deviceB)).cursor;

    // Device B goes offline and edits at t+1 min (its clock), and edits `shared` at t+30 s.
    const offlineNew = makeHighlight(child.id, doc.id, { text: 'lave', updatedAt: ctx.clock.now + 60_000 });
    const offlineEditOfShared = { ...shared, color: '#86efac', updatedAt: ctx.clock.now + 30_000 };

    // Meanwhile device A edits `shared` later (t+2 min) and syncs at t+5 min.
    ctx.advance(5 * 60_000);
    const aEdit = { ...shared, color: '#93c5fd', updatedAt: shared.updatedAt + 120_000 };
    const aSync = await sync(deviceA, { cursor: first.cursor, changes: { annotations: [aEdit] } });
    expect(aSync.rejected).toEqual([]);

    // B comes back 10 minutes later: its new annotation is older than A's last sync time.
    ctx.advance(10 * 60_000);
    const bSync = await sync(deviceB, { cursor: cursorB, changes: { annotations: [offlineNew, offlineEditOfShared] } });
    expect(bSync.rejected).toEqual([{ table: 'annotations', entityKey: shared.id, reason: 'stale' }]);
    // B receives A's winning version of `shared`.
    const sharedOnB = bSync.changes.annotations.find((a) => a.id === shared.id) as Annotation;
    expect(sharedOnB).toMatchObject({ color: '#93c5fd', updatedAt: aEdit.updatedAt });
    cursorB = bSync.cursor;

    const aPull = await sync(deviceA, { cursor: aSync.cursor });
    expect(aPull.changes.annotations.map((a) => a.id)).toEqual([offlineNew.id]);
    expect(aPull.changes.annotations[0]?.updatedAt).toBeLessThan(ctx.clock.now - 5 * 60_000);
    expect(Number(aPull.cursor)).toBeGreaterThan(Number(aSync.cursor));
    expect(Number(cursorB)).toBe(Number(aPull.cursor));
  });

  it('pages through more than 500 entities with increasing cursors', async () => {
    const doc = makeDocument(parentId);
    const annotations = Array.from({ length: 1150 }, (_, i) => makeHighlight(child.id, doc.id, { start: i, end: i + 1, updatedAt: ctx.clock.now + i }));
    const progress = makeProgress(child.id, doc.id);
    const pushed = await sync(deviceA, { changes: { documents: [doc], annotations, progress: [progress] } });
    expect(pushed.rejected).toEqual([]);
    // The pushing device itself receives the first page of its own writes.
    expect(pushed.hasMore).toBe(true);

    const { pages } = await pullAll(deviceB);
    expect(pages.map((p) => p.hasMore)).toEqual([true, true, false]);
    const sizes = pages.map((p) => Object.values(p.changes).reduce((n, list) => n + list.length, 0));
    expect(sizes).toEqual([500, 500, 153]); // 1 child + 1 document + 1150 annotations + 1 progress
    const cursors = pages.map((p) => Number(p.cursor));
    expect(cursors).toEqual([...cursors].sort((a, b) => a - b));
    const ids = pages.flatMap((p) => p.changes.annotations.map((a) => a.id));
    expect(new Set(ids).size).toBe(1150);
    expect(pages[2]?.changes.progress).toHaveLength(1);

    // An edit made after paging is delivered on the next pull.
    ctx.advance(1000);
    const edited = { ...annotations[3]!, color: '#f9a8d4', updatedAt: ctx.clock.now + 5000 };
    await sync(deviceA, { changes: { annotations: [edited] } });
    const next = await sync(deviceB, { cursor: pages[2]!.cursor });
    expect(next.changes.annotations).toEqual([edited]);
  });

  it('LWW: equal or older updatedAt is stale; far-future updatedAt is clamped to server time', async () => {
    const doc = makeDocument(parentId);
    await sync(deviceA, { changes: { documents: [doc] } });
    const same = await sync(deviceB, { changes: { documents: [{ ...doc, title: 'Autre titre' }] } });
    expect(same.rejected).toEqual([{ table: 'documents', entityKey: doc.id, reason: 'stale' }]);

    const future = makeHighlight(child.id, doc.id, { updatedAt: ctx.clock.now + 24 * 60 * 60_000 });
    const res = await sync(deviceA, { changes: { annotations: [future] } });
    const stored = res.changes.annotations.find((a) => a.id === future.id);
    expect(stored?.updatedAt).toBe(ctx.clock.now);

    const withinSkew = makeHighlight(child.id, doc.id, { updatedAt: ctx.clock.now + TIMINGS.syncMaxClockSkewMs });
    const res2 = await sync(deviceA, { changes: { annotations: [withinSkew] } });
    expect(res2.changes.annotations.find((a) => a.id === withinSkew.id)?.updatedAt).toBe(withinSkew.updatedAt);

    ctx.advance(1000);
    const newer = await sync(deviceB, { changes: { annotations: [{ ...future, color: '#16a34a', updatedAt: ctx.clock.now }] } });
    expect(newer.rejected).toEqual([]);
  });

  it('sends back the server version of stale or locked entities even when the cursor is already past them', async () => {
    const doc = makeDocument(parentId, { title: 'Version serveur' });
    const annotation = makeHighlight(child.id, doc.id);
    await sync(deviceA, { changes: { documents: [doc], annotations: [annotation] } });
    const upToDate = await sync(deviceB);

    const staleEdit = { ...annotation, color: '#dc2626' };
    const locked = { ...doc, deletedAt: ctx.clock.now + 1, updatedAt: ctx.clock.now + 1 };
    const foreignRef = makeHighlight(child.id, newId(), { documentId: newId() });
    const res = await sync(deviceB, { cursor: upToDate.cursor, changes: { documents: [locked], annotations: [staleEdit, foreignRef] } });
    expect(res.rejected.map((r) => r.reason)).toEqual(['parent_locked', 'stale', 'invalid']);
    expect(res.cursor).toBe(upToDate.cursor);
    expect(res.changes.documents).toEqual([doc]);
    expect(res.changes.annotations).toEqual([annotation]);
  });

  it('rejects invalid entities one by one and keeps the rest of the batch', async () => {
    const doc = makeDocument(parentId);
    const bad = { ...makeHighlight(child.id, doc.id), color: 'rouge' };
    const res = await sync(deviceA, { changes: { documents: [doc], annotations: [bad as unknown as Annotation, makeHighlight(child.id, doc.id)] } });
    expect(res.rejected).toEqual([{ table: 'annotations', entityKey: bad.id, reason: 'invalid' }]);
    expect(res.changes.annotations).toHaveLength(1);

    const orphanPage = await sync(deviceA, { changes: { pages: [makePage(newId())] } });
    expect(orphanPage.rejected[0]?.reason).toBe('invalid');

    const malformed = await deviceA.post('/api/sync').set(XRW).send({ cursor: 'abc', deviceId: 'd', changes: {} });
    expect(malformed.status).toBe(400);
  });

  it('a cursor ahead of the server counter restarts a full pull', async () => {
    const doc = makeDocument(parentId);
    await sync(deviceA, { changes: { documents: [doc] } });
    const res = await sync(deviceB, { cursor: '999999' });
    expect(res.changes.documents.map((d) => d.id)).toEqual([doc.id]);
  });

  it('accepts pages, exercises and annotations of a document created in the same batch; deleted children are stale', async () => {
    const doc = makeDocument(parentId);
    const res = await sync(deviceA, { changes: { documents: [doc], pages: [makePage(doc.id)], annotations: [makeHighlight(child.id, doc.id)] } });
    expect(res.rejected).toEqual([]);

    await unlock(deviceA);
    expect((await deviceA.delete(`/api/children/${child.id}`).set(XRW).send()).status).toBe(200);
    await lock(deviceA);
    const late = makeHighlight(child.id, doc.id);
    const after = await sync(deviceB, { changes: { annotations: [late] } });
    expect(after.rejected).toEqual([{ table: 'annotations', entityKey: late.id, reason: 'stale' }]);
  });
});

describe('sync: parent-only rules', () => {
  let ctx: TestContext;
  let parentId: string;
  let device: Agent;
  let child: ChildProfile;

  beforeEach(async () => {
    ctx = await createTestContext();
    const created = await newParent(ctx, EMAIL);
    parentId = created.parent.id;
    device = created.agent;
    child = await newChild(device);
  });
  afterEach(async () => ctx.close());

  async function serverDocument(id: string): Promise<DocumentMeta | undefined> {
    const { pages } = await pullAll(await login(ctx, EMAIL));
    return pages.flatMap((p) => p.changes.documents).find((d) => d.id === id);
  }

  it('a locked session cannot delete a document or change its children through sync, but can rename it', async () => {
    const doc = makeDocument(parentId, { childIds: [child.id] });
    const annotation = makeHighlight(child.id, doc.id);
    const first = await sync(device, { changes: { documents: [doc], annotations: [annotation] } });

    ctx.advance(1000);
    const deletion = { ...doc, deletedAt: ctx.clock.now, updatedAt: ctx.clock.now };
    const denied = await sync(device, { cursor: first.cursor, changes: { documents: [deletion] } });
    expect(denied.rejected).toEqual([{ table: 'documents', entityKey: doc.id, reason: 'parent_locked' }]);
    expect((await serverDocument(doc.id))?.deletedAt).toBeNull();

    const childChange = await sync(device, { changes: { documents: [{ ...doc, childIds: [], updatedAt: ctx.clock.now }] } });
    expect(childChange.rejected[0]?.reason).toBe('parent_locked');

    const rename = await sync(device, { changes: { documents: [{ ...doc, title: 'Les séismes', status: 'partial', updatedAt: ctx.clock.now }] } });
    expect(rename.rejected).toEqual([]);
    expect(await serverDocument(doc.id)).toMatchObject({ title: 'Les séismes', status: 'partial', deletedAt: null, childIds: [child.id] });

    // Unlocked: the deletion is accepted and cascades tombstones to annotations.
    await unlock(device);
    ctx.advance(1000);
    const accepted = await sync(device, { cursor: first.cursor, changes: { documents: [{ ...doc, title: 'Les séismes', deletedAt: ctx.clock.now, updatedAt: ctx.clock.now }] } });
    expect(accepted.rejected).toEqual([]);
    expect(accepted.changes.annotations.find((a) => a.id === annotation.id)?.deletedAt).toBe(ctx.clock.now);

    // A deleted document never comes back, even with a newer timestamp.
    await lock(device);
    ctx.advance(1000);
    const revive = await sync(device, { changes: { documents: [{ ...doc, updatedAt: ctx.clock.now }], pages: [makePage(doc.id, { updatedAt: ctx.clock.now })] } });
    expect(revive.rejected.map((r) => r.reason)).toEqual(['stale', 'stale']);
  });

  it('DELETE /api/documents/:id needs the unlock and soft-deletes the document with its annotations and exercises', async () => {
    const doc = makeDocument(parentId);
    const exercise = makeExercise(child.id, doc.id);
    const pushed = await sync(device, {
      changes: { documents: [doc], pages: [makePage(doc.id)], exercises: [exercise], annotations: [makeHighlight(child.id, doc.id)] },
    });
    expect((await pullAll(await login(ctx, EMAIL))).pages.flatMap((p) => p.changes.pages)).toHaveLength(1);
    expect((await device.delete(`/api/documents/${doc.id}`).set(XRW).send()).status).toBe(403);

    await unlock(device);
    ctx.advance(500);
    expect((await device.delete(`/api/documents/${doc.id}`).set(XRW).send()).body).toEqual({ ok: true });
    expect((await device.delete(`/api/documents/${newId()}`).set(XRW).send()).status).toBe(404);
    const pulled = await sync(device, { cursor: pushed.cursor });
    expect(pulled.changes.documents[0]?.deletedAt).toBe(ctx.clock.now);
    expect(pulled.changes.annotations[0]?.deletedAt).toBe(ctx.clock.now);
    expect(pulled.changes.exercises[0]?.deletedAt).toBe(ctx.clock.now);
    // Page text of the deleted document is not sent to a new device.
    const fresh = await pullAll(await login(ctx, EMAIL));
    expect(fresh.pages.flatMap((p) => p.changes.pages)).toEqual([]);
  });

  it('children through sync: only reading/tts preferences are applied, the rest is ignored and reported', async () => {
    ctx.advance(1000);
    const incoming: ChildProfile = {
      ...child,
      firstName: 'Pirate',
      age: 15,
      reading: { ...child.reading, fontSizePx: 32 },
      tts: { ...child.tts, rate: 1.1 },
      updatedAt: ctx.clock.now,
    };
    const res = await sync(device, { changes: { children: [incoming] } });
    expect(res.rejected).toEqual([{ table: 'children', entityKey: child.id, reason: 'forbidden' }]);
    const serverChild = res.changes.children.find((c) => c.id === child.id);
    expect(serverChild).toMatchObject({ firstName: child.firstName, age: child.age, reading: { fontSizePx: 32 }, tts: { rate: 1.1 } });

    const prefsOnly = await sync(device, { changes: { children: [{ ...child, reading: { ...child.reading, theme: 'sombre' }, updatedAt: ctx.clock.now + 1 }] } });
    expect(prefsOnly.rejected).toEqual([]);

    const unknown = { ...child, id: newId(), updatedAt: ctx.clock.now + 2 };
    const creation = await sync(device, { changes: { children: [unknown] } });
    expect(creation.rejected).toEqual([{ table: 'children', entityKey: unknown.id, reason: 'forbidden' }]);

    const stale = await sync(device, { changes: { children: [{ ...child, reading: { ...child.reading, fontSizePx: 18 }, updatedAt: child.updatedAt }] } });
    expect(stale.rejected[0]?.reason).toBe('stale');

    const deletion = await sync(device, { changes: { children: [{ ...child, deletedAt: ctx.clock.now, updatedAt: ctx.clock.now + 3 }] } });
    expect(deletion.rejected[0]?.reason).toBe('forbidden');
    expect((await device.get('/api/children')).body).toHaveLength(1);
  });

  it('privacy: syncAnnotations=false neither accepts nor returns annotations; syncDocumentText=false stores pages without text', async () => {
    const doc = makeDocument(parentId);
    const before = makeHighlight(child.id, doc.id);
    await sync(device, { changes: { documents: [doc], annotations: [before] } });

    await unlock(device);
    const settings = { ...DEFAULT_PARENT_SETTINGS, privacy: { ...DEFAULT_PARENT_SETTINGS.privacy, syncAnnotations: false, syncDocumentText: false } };
    expect((await device.put('/api/settings').set(XRW).send(settings)).status).toBe(200);
    await lock(device);

    const after = makeHighlight(child.id, doc.id);
    const page = makePage(doc.id);
    const res = await sync(device, { changes: { annotations: [after], pages: [page] } });
    expect(res.rejected).toEqual([{ table: 'annotations', entityKey: after.id, reason: 'forbidden' }]);
    expect(await ctx.db('annotations').where('id', after.id).first()).toBeUndefined();

    const fresh = await pullAll(await login(ctx, EMAIL));
    const all = fresh.pages.flatMap((p: SyncResponse) => p.changes.annotations);
    expect(all).toEqual([]);
    const pages = fresh.pages.flatMap((p) => p.changes.pages);
    expect(pages).toEqual([{ ...page, blocks: [] }]);
  });
});
