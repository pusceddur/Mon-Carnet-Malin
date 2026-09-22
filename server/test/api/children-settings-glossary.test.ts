import { type ChildProfile, DEFAULT_PARENT_SETTINGS, DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES } from '@aide/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Agent, createTestContext, lock, newParent, sync, type TestContext, unlock, XRW } from '../platform/helpers';

describe('children routes', () => {
  let ctx: TestContext;
  let agent: Agent;

  beforeEach(async () => {
    ctx = await createTestContext();
    agent = (await newParent(ctx, 'enfants@example.fr')).agent;
  });
  afterEach(async () => ctx.close());

  it('creation needs the unlock and applies defaults', async () => {
    expect((await agent.post('/api/children').set(XRW).send({ nickname: 'Zoé' })).status).toBe(403);
    await unlock(agent);
    const res = await agent.post('/api/children').set(XRW).send({ nickname: '  Zoé ', reading: { fontSizePx: 28 }, tts: { rate: 0.7 } });
    expect(res.status).toBe(201);
    const child = res.body as ChildProfile;
    expect(child).toMatchObject({
      nickname: 'Zoé', readingLevel: 'intermediaire', explanationDifficulty: 'simple', deletedAt: null,
      reading: { ...DEFAULT_READING_PREFERENCES, fontSizePx: 28 }, tts: { ...DEFAULT_TTS_PREFERENCES, rate: 0.7 },
      createdAt: ctx.clock.now, updatedAt: ctx.clock.now,
    });
    expect((await agent.post('/api/children').set(XRW).send({ nickname: '' })).status).toBe(400);
    expect((await agent.post('/api/children').set(XRW).send({ nickname: 'M'.repeat(41) })).status).toBe(400);
    expect((await agent.get('/api/children')).body).toEqual([child]);
  });

  it('PUT replaces the profile (unlock), PATCH preferences works for the child without unlock, DELETE is soft', async () => {
    await unlock(agent);
    const child = (await agent.post('/api/children').set(XRW).send({ nickname: 'Noé' })).body as ChildProfile;

    ctx.advance(1000);
    const put = await agent.put(`/api/children/${child.id}`).set(XRW).send({ ...child, avatar: '🐢', createdAt: 1, parentId: 'x' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ avatar: '🐢', createdAt: child.createdAt, parentId: child.parentId, updatedAt: ctx.clock.now });
    expect((await agent.put(`/api/children/${child.id}`).set(XRW).send({ ...child, id: 'autre' })).status).toBe(400);

    await lock(agent);
    expect((await agent.put(`/api/children/${child.id}`).set(XRW).send(child)).status).toBe(403);
    ctx.advance(1000);
    const patch = await agent.patch(`/api/children/${child.id}/preferences`).set(XRW).send({ reading: { theme: 'sombre', lineHeight: 2 }, tts: { rate: 1.2 } });
    expect(patch.status).toBe(200);
    expect(patch.body.reading).toMatchObject({ theme: 'sombre', lineHeight: 2, fontSizePx: DEFAULT_READING_PREFERENCES.fontSizePx });
    expect(patch.body.tts.rate).toBe(1.2);
    // §32: the nickname is the only thing about the reader, and a preferences patch never touches it.
    expect(patch.body.nickname).toBe('Noé');
    expect((await agent.patch(`/api/children/${child.id}/preferences`).set(XRW).send({ reading: { fontSizePx: 100 } })).status).toBe(400);
    // §26 couleurs de lecture: saved, and kept when another preference changes.
    const aids = { syllables: true, silentLetters: true, sounds: false, changedLetters: false, liaisons: true };
    expect((await agent.patch(`/api/children/${child.id}/preferences`).set(XRW).send({ reading: { aids } })).body.reading.aids).toEqual(aids);
    const later = await agent.patch(`/api/children/${child.id}/preferences`).set(XRW).send({ reading: { fontSizePx: 30 } });
    expect(later.body.reading).toMatchObject({ fontSizePx: 30, aids });
    // The pauses of the voice (§22) are kept too.
    await agent.patch(`/api/children/${child.id}/preferences`).set(XRW).send({ tts: { sentencePauseMs: 900 } });
    expect((await agent.patch(`/api/children/${child.id}/preferences`).set(XRW).send({ tts: { rate: 1 } })).body.tts).toMatchObject({ rate: 1, sentencePauseMs: 900 });

    // Profile edits reach devices through sync.
    const pulled = await sync(agent);
    expect(pulled.changes.children[0]).toMatchObject({ reading: { theme: 'sombre' } });

    expect((await agent.delete(`/api/children/${child.id}`).set(XRW).send()).status).toBe(403);
    await unlock(agent);
    ctx.advance(1000);
    expect((await agent.delete(`/api/children/${child.id}`).set(XRW).send()).body).toEqual({ ok: true });
    expect((await agent.get('/api/children')).body).toEqual([]);
    const tombstone = await sync(agent, { cursor: pulled.cursor });
    expect(tombstone.changes.children[0]?.deletedAt).toBe(ctx.clock.now);
    expect((await agent.patch(`/api/children/${child.id}/preferences`).set(XRW).send({ tts: { rate: 1 } })).status).toBe(404);
  });
});

describe('settings routes', () => {
  let ctx: TestContext;
  afterEach(async () => ctx.close());

  it('GET answers defaults, PUT (unlock) validates, merges and stamps updatedAt', async () => {
    ctx = await createTestContext();
    const { agent } = await newParent(ctx, 'reglages@example.fr');
    expect((await agent.get('/api/settings')).body).toEqual(DEFAULT_PARENT_SETTINGS);

    await unlock(agent);
    const next = { ...DEFAULT_PARENT_SETTINGS, ai: { ...DEFAULT_PARENT_SETTINGS.ai, enabled: false, monthlyBudgetEur: 4.5 }, updatedAt: 5 };
    const res = await agent.put('/api/settings').set(XRW).send(next);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...next, updatedAt: ctx.clock.now });
    expect((await agent.get('/api/settings')).body).toEqual(res.body);

    const invalid = await agent.put('/api/settings').set(XRW).send({ ...next, ocr: { autoServerFallback: true, lowConfidenceThreshold: 400 } });
    expect(invalid.status).toBe(400);
    const partial = await agent.put('/api/settings').set(XRW).send({ ai: next.ai });
    expect(partial.status).toBe(400);
  });
});

describe('glossary routes', () => {
  let ctx: TestContext;
  afterEach(async () => ctx.close());

  it('CRUD with normalized headwords', async () => {
    ctx = await createTestContext();
    const { agent } = await newParent(ctx, 'glossaire@example.fr');
    const entry = { headword: 'Éruption', partOfSpeech: 'nom', kidDefinition: 'Quand un volcan crache de la lave.', example: null, forms: ['éruptions'] };
    expect((await agent.put('/api/glossary/éruption').set(XRW).send(entry)).status).toBe(403);

    await unlock(agent);
    const put = await agent.put(`/api/glossary/${encodeURIComponent('ÉRUPTION')}`).set(XRW).send(entry);
    expect(put.status).toBe(200);
    expect(put.body.headword).toBe('éruption');
    expect((await agent.put('/api/glossary/lave').set(XRW).send(entry)).status).toBe(400);
    expect((await agent.put('/api/glossary/lave').set(XRW).send({ ...entry, headword: 'lave', partOfSpeech: 'truc' })).status).toBe(400);

    const updated = await agent.put(`/api/glossary/${encodeURIComponent('éruption')}`).set(XRW).send({ ...entry, kidDefinition: 'La lave sort du volcan.' });
    expect(updated.status).toBe(200);
    await lock(agent);
    const list = (await agent.get('/api/glossary')).body;
    expect(list).toEqual([{ ...entry, headword: 'éruption', kidDefinition: 'La lave sort du volcan.' }]);

    await unlock(agent);
    expect((await agent.delete(`/api/glossary/${encodeURIComponent('Éruption')}`).set(XRW).send()).body).toEqual({ ok: true });
    expect((await agent.get('/api/glossary')).body).toEqual([]);
  });
});
