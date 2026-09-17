import { type ChildProfile, DEFAULT_PARENT_SETTINGS, type DocumentMeta, newId } from '@aide/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getChild } from '../../src/db/repositories/children';
import { getParentSettings } from '../../src/db/repositories/settings';
import {
  type Agent, createTestContext, makeAnswer, makeDocument, makeExercise, makeHighlight, makePage, makeProgress, makeReadingSession,
  newChild, newParent, pullAll, sync, type TestContext, unlock, XRW,
} from '../platform/helpers';

describe('isolation between two parents', () => {
  let ctx: TestContext;
  let a: { id: string; agent: Agent; child: ChildProfile; doc: DocumentMeta; exerciseId: string; annotationId: string; sessionId: string; alertId: string };
  let b: { id: string; agent: Agent; child: ChildProfile; doc: DocumentMeta };

  beforeAll(async () => {
    ctx = await createTestContext();
    const pa = await newParent(ctx, 'a@example.fr');
    const pb = await newParent(ctx, 'b@example.fr');
    const childA = await newChild(pa.agent, 'Alice');
    const childB = await newChild(pb.agent, 'Basile');
    const docA = makeDocument(pa.parent.id, { childIds: [childA.id] });
    const exercise = makeExercise(childA.id, docA.id);
    const annotation = makeHighlight(childA.id, docA.id);
    const session = makeReadingSession(childA.id, docA.id);
    const res = await sync(pa.agent, {
      changes: {
        documents: [docA], pages: [makePage(docA.id)], exercises: [exercise], annotations: [annotation],
        answers: [makeAnswer(childA.id, exercise.id)], progress: [makeProgress(childA.id, docA.id)], sessions: [session],
      },
    });
    expect(res.rejected).toEqual([]);

    await unlock(pa.agent);
    expect((await pa.agent.put('/api/glossary/magma').set(XRW)
      .send({ headword: 'magma', partOfSpeech: 'nom', kidDefinition: 'Roche fondue sous la terre.', example: null })).status).toBe(200);
    const settings = { ...DEFAULT_PARENT_SETTINGS, ai: { ...DEFAULT_PARENT_SETTINGS.ai, monthlyBudgetEur: 3 } };
    expect((await pa.agent.put('/api/settings').set(XRW).send(settings)).status).toBe(200);

    const alertId = newId();
    await ctx.db('safety_alerts').insert({ id: alertId, parent_id: pa.parent.id, child_id: childA.id, document_id: docA.id, kind: 'safety_input', detail: 'x', created_at: ctx.clock.now });

    const docB = makeDocument(pb.parent.id, { childIds: [childB.id] });
    expect((await sync(pb.agent, { changes: { documents: [docB] } })).rejected).toEqual([]);

    a = { id: pa.parent.id, agent: pa.agent, child: childA, doc: docA, exerciseId: exercise.id, annotationId: annotation.id, sessionId: session.id, alertId };
    b = { id: pb.parent.id, agent: pb.agent, child: childB, doc: docB };
    await unlock(b.agent);
  });
  afterAll(async () => ctx.close());

  it('REST: children, settings, glossary, documents and activity of A are invisible to B', async () => {
    const children = (await b.agent.get('/api/children')).body as ChildProfile[];
    expect(children.map((c) => c.id)).toEqual([b.child.id]);
    expect((await b.agent.put(`/api/children/${a.child.id}`).set(XRW).send({ ...a.child, firstName: 'Volé' })).status).toBe(404);
    expect((await b.agent.patch(`/api/children/${a.child.id}/preferences`).set(XRW).send({ reading: { fontSizePx: 40 } })).status).toBe(404);
    expect((await b.agent.delete(`/api/children/${a.child.id}`).set(XRW).send()).status).toBe(404);
    expect((await b.agent.delete(`/api/documents/${a.doc.id}`).set(XRW).send()).status).toBe(404);
    expect((await b.agent.get('/api/glossary')).body).toEqual([]);
    expect((await b.agent.delete('/api/glossary/magma').set(XRW).send()).status).toBe(200);
    expect((await a.agent.get('/api/glossary')).body).toHaveLength(1);
    expect((await b.agent.get('/api/settings')).body.ai.monthlyBudgetEur).toBe(DEFAULT_PARENT_SETTINGS.ai.monthlyBudgetEur);

    const activity = (await b.agent.get('/api/activity')).body;
    expect(activity.sessions).toEqual([]);
    expect(activity.alerts).toEqual([]);
    expect((await b.agent.post(`/api/activity/alerts/${a.alertId}/seen`).set(XRW).send()).status).toBe(404);

    expect(await getChild(ctx.db, b.id, a.child.id)).toBeNull();
    expect((await getChild(ctx.db, a.id, a.child.id))?.firstName).toBe('Alice');
    expect((await getParentSettings(ctx.db, a.id)).ai.monthlyBudgetEur).toBe(3);
    expect((await getParentSettings(ctx.db, b.id)).ai.monthlyBudgetEur).toBe(DEFAULT_PARENT_SETTINGS.ai.monthlyBudgetEur);
  });

  it('sync: ID collisions with A entities are forbidden and leave A untouched', async () => {
    ctx.advance(10_000);
    const now = ctx.clock.now;
    const res = await sync(b.agent, {
      changes: {
        children: [{ ...a.child, parentId: b.id, reading: { ...a.child.reading, fontSizePx: 44 }, updatedAt: now }],
        documents: [
          { ...a.doc, ownerParentId: b.id, title: 'Pris', updatedAt: now },
          makeDocument(a.id, { title: 'Au nom de A' }),
        ],
        pages: [makePage(a.doc.id, { updatedAt: now })],
        exercises: [makeExercise(b.child.id, b.doc.id, { id: a.exerciseId, updatedAt: now })],
        annotations: [
          makeHighlight(b.child.id, b.doc.id, { id: a.annotationId, updatedAt: now }),
          makeHighlight(a.child.id, b.doc.id, { updatedAt: now }),
          makeHighlight(b.child.id, a.doc.id, { updatedAt: now }),
        ],
        answers: [makeAnswer(b.child.id, a.exerciseId, { updatedAt: now })],
        progress: [makeProgress(a.child.id, b.doc.id, { updatedAt: now }), makeProgress(b.child.id, a.doc.id, { updatedAt: now })],
        sessions: [makeReadingSession(b.child.id, b.doc.id, { id: a.sessionId, updatedAt: now })],
      },
    });
    expect(res.rejected.map((r) => `${r.table}:${r.reason}`)).toEqual([
      'children:forbidden',
      'documents:forbidden',
      'documents:forbidden',
      'pages:forbidden',
      'exercises:forbidden',
      'annotations:forbidden',
      'annotations:forbidden',
      'annotations:forbidden',
      'answers:forbidden',
      'progress:forbidden',
      'progress:forbidden',
      'sessions:forbidden',
    ]);

    // Neither the push response (which returns server versions of rejected entities) nor B's pull contains A data.
    const bAll = await pullAll(b.agent);
    const bChanges = [res, ...bAll.pages].flatMap((p) => Object.values(p.changes).flat()) as { id?: string; childId?: string; documentId?: string }[];
    expect(bChanges.length).toBeGreaterThan(0);
    const aIds = new Set([a.child.id, a.doc.id, a.exerciseId, a.annotationId, a.sessionId]);
    for (const e of bChanges as { id?: string; childId?: string; documentId?: string; exerciseId?: string }[]) {
      for (const ref of [e.id, e.childId, e.documentId, e.exerciseId]) expect(ref === undefined || !aIds.has(ref)).toBe(true);
    }

    // A still sees its own untouched data.
    const aAll = await pullAll(a.agent);
    const docs = aAll.pages.flatMap((p) => p.changes.documents);
    expect(docs.find((d) => d.id === a.doc.id)).toMatchObject({ title: a.doc.title, ownerParentId: a.id });
    expect(aAll.pages.flatMap((p) => p.changes.children).find((c) => c.id === a.child.id)?.reading.fontSizePx).toBe(a.child.reading.fontSizePx);
    expect(aAll.pages.flatMap((p) => p.changes.annotations).map((x) => x.childId)).toEqual([a.child.id]);
    expect(await ctx.db('documents').where('parent_id', a.id).count({ n: '*' }).first()).toMatchObject({ n: 1 });
  });
});
