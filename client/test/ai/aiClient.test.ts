import type { ExplainWordRequest, GenerateQuestionsRequest, Question } from '@aide/shared';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localAICacheKey, lookupDefinition, lookupLocalExplanation, requestAI, stableStringify } from '../../src/ai/aiClient';
import { db } from '../../src/db/localDb';
import { useSessionStore } from '../../src/state/session';
import { HASH, json, makeChild, meta, mockFetch, page, setOnline } from './helpers';

const localQuestion: Question = {
  id: 'q1', type: 'qcm', prompt: 'Quel mot manque ?', source: { pageIndex: 0, quote: 'Le chat dort.' },
  choices: ['chat', 'chien'], correctIndex: 0, explanation: 'C’est écrit dans le texte.',
};

vi.mock('@aide/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aide/shared')>();
  return { ...actual, generateLocalQuestions: vi.fn(() => [localQuestion]) };
});

const wordBody: ExplainWordRequest = {
  childId: 'child-1', documentId: 'doc-1', documentHash: HASH, word: 'photosynthèse', sentence: 'La photosynthèse nourrit la plante.',
  paragraph: 'La photosynthèse nourrit la plante.', pageIndex: 0, ocrLowConfidence: false,
};

const explanation = { explanation: 'Les plantes fabriquent leur nourriture avec la lumière.', example: null, sourceQuotes: ['La photosynthèse'] };

afterAll(() => {
  db.close();
});

async function resetDb(): Promise<void> {
  await Promise.all([db.aiCache.clear(), db.dictionaryCache.clear(), db.glossary.clear(), db.children.clear()]);
}

describe('requestAI', () => {
  beforeEach(async () => {
    setOnline(true);
    useSessionStore.setState({ children: [makeChild()], parentSettings: null });
    await resetDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('offline: resolves unavailable/offline immediately without network', async () => {
    setOnline(false);
    const { fn } = mockFetch(() => json({}));
    const result = await requestAI('explain_text', { ...wordBody, text: 'La photosynthèse', paragraph: 'x' });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'offline', meta: null });
    expect(result.status === 'unavailable' && result.message).toContain('Pas de connexion');
    expect(fn).not.toHaveBeenCalled();
  });

  it('posts to /api/ai/:op, caches validated results and serves them from the cache (also offline)', async () => {
    const { calls } = mockFetch(() => json({ status: 'ok', data: explanation, meta: meta() }));
    const first = await requestAI('explain_word', wordBody);
    expect(first).toMatchObject({ status: 'ok', data: explanation, meta: { cached: false } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/ai/explain_word' });

    const second = await requestAI('explain_word', wordBody);
    expect(second).toMatchObject({ status: 'ok', meta: { cached: true } });
    setOnline(false);
    const offline = await requestAI('explain_word', wordBody);
    expect(offline).toMatchObject({ status: 'ok', meta: { cached: true } });
    expect(calls).toHaveLength(1);
  });

  it('does not cache blocked results or local-route answers', async () => {
    let n = 0;
    const { calls } = mockFetch(() => {
      n += 1;
      return n === 1
        ? json({ status: 'blocked', reason: 'safety_input', message: '', meta: meta() })
        : json({ status: 'ok', data: explanation, meta: meta({ route: 'local' }) });
    });
    const blocked = await requestAI('explain_word', wordBody);
    expect(blocked).toMatchObject({ status: 'blocked', reason: 'safety_input' });
    expect(blocked.status === 'blocked' && blocked.message).toContain('adulte');
    await requestAI('explain_word', wordBody);
    await requestAI('explain_word', wordBody);
    expect(calls).toHaveLength(3);
  });

  it('polls GET /api/ai/jobs/:id after a 202 until the result arrives', async () => {
    let polls = 0;
    const { calls } = mockFetch((call) => {
      if (call.method === 'POST') return json({ status: 'pending', jobId: 'job-1', pollAfterMs: 1 }, 202);
      polls += 1;
      return polls < 2 ? json({ status: 'pending', pollAfterMs: 1 }) : json({ status: 'ok', data: { simplifiedText: 'Plus simple.' }, meta: meta({ route: 'complex' }) });
    });
    const result = await requestAI('simplify_text', { childId: 'child-1', documentId: 'doc-1', documentHash: HASH, text: 'x'.repeat(2000), pageIndex: 0, ocrLowConfidence: false });
    expect(result).toMatchObject({ status: 'ok', data: { simplifiedText: 'Plus simple.' } });
    expect(calls.filter((c) => c.url === '/api/ai/jobs/job-1')).toHaveLength(2);
  });

  it('gives up with unavailable/timeout once the job deadline (AI_DEADLINES + 15 s) is past', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mockFetch((call) => {
      if (call.method === 'POST') return json({ status: 'pending', jobId: 'job-2', pollAfterMs: 1 }, 202);
      now += 100_000;
      return json({ status: 'pending', pollAfterMs: 1 });
    });
    const result = await requestAI('simplify_text', { childId: 'child-1', documentId: null, documentHash: null, text: 'abc', pageIndex: 0, ocrLowConfidence: false });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'timeout' });
  });

  it('keeps polling until start + waitMs when the 202 answer gives one (external worker deadlines)', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let polls = 0;
    mockFetch((call) => {
      if (call.method === 'POST') return json({ status: 'pending', jobId: 'job-3', pollAfterMs: 1, waitMs: 400_000 }, 202);
      polls += 1;
      now += 100_000;
      // Third poll at start + 300 s: past the default deadline (AI_DEADLINES.complex + 15 s), still inside waitMs.
      return polls < 3 ? json({ status: 'pending', pollAfterMs: 1 }) : json({ status: 'ok', data: { simplifiedText: 'Plus simple.' }, meta: meta({ route: 'complex' }) });
    });
    const body = { childId: 'child-1', documentId: null, documentHash: null, text: 'abcd', pageIndex: 0, ocrLowConfidence: false };
    expect(await requestAI('simplify_text', body)).toMatchObject({ status: 'ok', data: { simplifiedText: 'Plus simple.' } });
    expect(polls).toBe(3);
  });

  it('a short waitMs also ends the polling earlier than the default deadline', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let polls = 0;
    mockFetch((call) => {
      if (call.method === 'POST') return json({ status: 'pending', jobId: 'job-4', pollAfterMs: 1, waitMs: 50_000 }, 202);
      polls += 1;
      now += 100_000;
      return json({ status: 'pending', pollAfterMs: 1 });
    });
    const body = { childId: 'child-1', documentId: null, documentHash: null, text: 'abcde', pageIndex: 0, ocrLowConfidence: false };
    expect(await requestAI('simplify_text', body)).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    // The default deadline would have allowed a second poll.
    expect(polls).toBe(1);
  });

  it('maps HTTP and network failures to unavailable reasons, never throws', async () => {
    const body = { ...wordBody, word: 'zzmagma' };
    mockFetch(() => json({ error: { code: 'payload_too_large', message: 'Trop gros' } }, 413));
    expect(await requestAI('explain_word', body)).toMatchObject({ status: 'unavailable', reason: 'payload_too_large' });

    mockFetch(() => json({ error: { code: 'ocr_busy', message: 'Occupé' } }, 503));
    expect(await requestAI('explain_word', body)).toMatchObject({ status: 'unavailable', reason: 'busy' });

    mockFetch(() => json({ nonsense: true }));
    expect(await requestAI('explain_word', body)).toMatchObject({ status: 'unavailable', reason: 'provider_error' });

    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await requestAI('explain_word', body)).toMatchObject({ status: 'unavailable', reason: 'offline' });
  });

  it('returns unavailable/timeout when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    mockFetch(() => json({ status: 'ok', data: explanation, meta: meta() }));
    expect(await requestAI('explain_word', wordBody, { signal: controller.signal })).toMatchObject({ status: 'unavailable', reason: 'timeout' });
  });

  it('explain_word falls back to the local glossary (parent entries in Dexie) when the AI is unavailable', async () => {
    setOnline(false);
    await db.glossary.put({ headword: 'photosynthèse', partOfSpeech: 'nom', kidDefinition: 'Comment la plante se nourrit avec la lumière.', example: null });
    const result = await requestAI('explain_word', wordBody);
    expect(result).toMatchObject({
      status: 'ok',
      data: { explanation: 'Comment la plante se nourrit avec la lumière.', example: null, sourceQuotes: [] },
      meta: { route: 'local', cached: false },
    });
  });

  it('generate_questions falls back to local questions (route local) when the server fails', async () => {
    mockFetch(() => json({ error: { code: 'internal', message: 'Erreur' } }, 500));
    const body: GenerateQuestionsRequest = {
      childId: 'child-1', documentId: 'doc-1', documentHash: HASH, count: 3, types: ['qcm'], pages: [page(0, 'Le chat dort.', true)],
    };
    const result = await requestAI('generate_questions', body);
    expect(result).toMatchObject({ status: 'ok', data: { questions: [localQuestion] }, meta: { route: 'local', sourceWarning: true } });
  });

  it('never caches handwriting recognition', async () => {
    const { calls } = mockFetch(() => json({ status: 'ok', data: { text: 'bonjour' }, meta: meta() }));
    const body = { childId: 'child-1', documentId: null, documentHash: null, imagePngBase64: 'iVBORw0KGgo=' };
    await requestAI('recognize_handwriting', body);
    await requestAI('recognize_handwriting', body);
    expect(calls).toHaveLength(2);
    expect(await db.aiCache.count()).toBe(0);
  });
});

describe('cache key', () => {
  beforeEach(() => {
    useSessionStore.setState({ children: [makeChild(), makeChild({ id: 'child-2', firstName: 'Zoé' }), makeChild({ id: 'child-3', age: 8 })] });
  });

  it('stableStringify sorts keys recursively and normalizes strings', () => {
    expect(stableStringify({ b: 1, a: { d: [2, 'é'], c: undefined } })).toBe(stableStringify({ a: { d: [2, 'é'] }, b: 1 }));
  });

  it('ignores the child id but depends on the learner profile and the request', async () => {
    const k1 = await localAICacheKey('explain_word', wordBody);
    expect(await localAICacheKey('explain_word', { ...wordBody, childId: 'child-2' })).toBe(k1);
    expect(await localAICacheKey('explain_word', { ...wordBody, childId: 'child-3' })).not.toBe(k1);
    expect(await localAICacheKey('explain_word', { ...wordBody, word: 'zzmagma' })).not.toBe(k1);
    expect(await localAICacheKey('explain_text', { ...wordBody, text: 'photosynthèse' })).not.toBe(k1);
  });
});

describe('lookupDefinition', () => {
  beforeEach(async () => {
    setOnline(true);
    await resetDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the parent glossary first, without network', async () => {
    const { fn } = mockFetch(() => json({ status: 'not_found' }));
    await db.glossary.put({ headword: 'volcan', partOfSpeech: 'nom', kidDefinition: 'Une montagne qui crache du feu.', example: 'Le volcan fume.' });
    const result = await lookupDefinition(' Volcan, ');
    expect(result).toEqual({
      status: 'found',
      entry: {
        headword: 'volcan', lemma: 'volcan', partOfSpeech: 'nom', definition: 'Une montagne qui crache du feu.', example: 'Le volcan fume.',
        source: 'glossaire_parent', attribution: null, kidFriendly: true,
      },
    });
    expect(fn).not.toHaveBeenCalled();
    expect(await lookupLocalExplanation('volcan')).toMatchObject({ definition: 'Une montagne qui crache du feu.' });
  });

  it('asks the server, caches the answer and reuses it offline', async () => {
    const found = {
      status: 'found',
      entry: {
        headword: 'zzmot', lemma: 'zzmot', partOfSpeech: 'nom', definition: 'Un mot de test.', example: null, source: 'wiktionnaire',
        attribution: 'Wiktionnaire (CC BY-SA)', kidFriendly: true,
      },
    };
    const { calls } = mockFetch(() => json(found));
    expect(await lookupDefinition('Zzmot')).toEqual(found);
    expect(calls[0]?.url).toBe('/api/dictionary?word=Zzmot');
    setOnline(false);
    expect(await lookupDefinition('zzmot')).toEqual(found);
    expect(calls).toHaveLength(1);
    expect(await lookupLocalExplanation('zzmot')).toMatchObject({ definition: 'Un mot de test.' });
  });

  it('offline without cache → unavailable; stale not_found is fetched again', async () => {
    setOnline(false);
    const { calls } = mockFetch(() => json({ status: 'found', entry: { headword: 'zzvieux', lemma: 'zzvieux', partOfSpeech: null, definition: 'Vieux.', example: null, source: 'wiktionnaire', attribution: null, kidFriendly: false } }));
    expect(await lookupDefinition('zzabsent')).toEqual({ status: 'unavailable' });

    await db.dictionaryCache.put({ word: 'zzvieux', result: { status: 'not_found' }, fetchedAt: Date.now() - 8 * 24 * 60 * 60_000 });
    expect(await lookupDefinition('zzvieux')).toEqual({ status: 'not_found' });
    setOnline(true);
    expect(await lookupDefinition('zzvieux')).toMatchObject({ status: 'found' });
    expect(calls).toHaveLength(1);
    // Not kid-friendly: not usable as a local explanation.
    expect(await lookupLocalExplanation('zzvieux')).toBeNull();
  });

  it('server errors → unavailable, never throws', async () => {
    mockFetch(() => json({ error: { code: 'internal', message: 'x' } }, 500));
    expect(await lookupDefinition('zzerreur')).toEqual({ status: 'unavailable' });
  });
});
