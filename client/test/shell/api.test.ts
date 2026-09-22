import { DEFAULT_PARENT_SETTINGS } from '@aide/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markAlertSeen, getActivity } from '../../src/api/activity';
import { getInvitation, updateInvitation } from '../../src/api/admin';
import { changePin, getAuthStatus, lock, login, logout, register, unlock } from '../../src/api/auth';
import { createChild, deleteChild, updateChildPreferences } from '../../src/api/children';
import { deleteGlossaryEntry, putGlossaryEntry } from '../../src/api/glossary';
import { getWorkerStatus, putSettings } from '../../src/api/settings';
import { postSync } from '../../src/api/sync';
import { relaunchTranscription } from '../../src/api/worker';

function mockFetch() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api wrappers', () => {
  it('call the contract endpoints with the right methods', async () => {
    const calls = mockFetch();
    await getAuthStatus();
    await login({ email: 'a@example.org', password: 'x' });
    await register({ inviteCode: 'K7QM-3FXA-9TRD', email: 'b@example.org', password: 'motdepasse!', displayName: 'B', pin: '246810' });
    await unlock({ pin: '123456' });
    await lock();
    await changePin({ password: 'x', newPin: '1234' });
    await logout();
    await createChild({ nickname: 'Léa' });
    await updateChildPreferences('c 1', { reading: { fontSizePx: 30 } });
    await deleteChild('c1');
    await putSettings(DEFAULT_PARENT_SETTINGS);
    await putGlossaryEntry({ headword: 'arc-en-ciel', partOfSpeech: 'nom', kidDefinition: 'Des couleurs dans le ciel.', example: null });
    await deleteGlossaryEntry('l’été');
    await getActivity({ childId: 'c1', from: 10, to: 20 });
    await getActivity();
    await markAlertSeen('al/1');
    await getInvitation();
    await updateInvitation({ enabled: true, regenerate: true });
    await postSync({ cursor: null, deviceId: 'd', changes: { documents: [], pages: [], annotations: [], progress: [], sessions: [], exercises: [], answers: [], children: [] } });

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/auth/status',
      'POST /api/auth/login',
      'POST /api/auth/register',
      'POST /api/auth/unlock',
      'POST /api/auth/lock',
      'PUT /api/auth/pin',
      'POST /api/auth/logout',
      'POST /api/children',
      'PATCH /api/children/c%201/preferences',
      'DELETE /api/children/c1',
      'PUT /api/settings',
      'PUT /api/glossary/arc-en-ciel',
      'DELETE /api/glossary/l%E2%80%99%C3%A9t%C3%A9',
      'GET /api/activity?childId=c1&from=10&to=20',
      'GET /api/activity',
      'POST /api/activity/alerts/al%2F1/seen',
      'GET /api/admin/invitation',
      'PUT /api/admin/invitation',
      'POST /api/sync',
    ]);
    expect(calls[2]?.body).toMatchObject({ inviteCode: 'K7QM-3FXA-9TRD', email: 'b@example.org' });
    expect(calls[3]?.body).toEqual({ pin: '123456' });
    expect(calls[5]?.body).toEqual({ password: 'x', newPin: '1234' });
    expect(calls.at(-2)?.body).toEqual({ enabled: true, regenerate: true });
  });
});

describe('lecture intelligente wrappers', () => {
  const workerStatus = { configured: true, connected: true, lastSeenAt: 1_000, limited: false, limitResetsAt: null, queued: { ai: 0, pageText: 3 } };

  function respond(body: unknown, status = 200) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }));
    return calls;
  }

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  });

  it('getWorkerStatus reads GET /api/settings/worker and validates the answer', async () => {
    const calls = respond(workerStatus);
    // A server from before §21/§22: the new fields get their defaults.
    expect(await getWorkerStatus()).toEqual({
      ...workerStatus, queued: { ...workerStatus.queued, pageSpeech: 0 }, usage: null, estimate: { monthToDateEur: 0, allAccountsEur: null },
    });
    expect(calls[0]?.url).toBe('/api/settings/worker');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.credentials).toBe('include');
    expect((calls[0]?.init.headers as Record<string, string>)['X-Requested-With']).toBe('aide');
  });

  it('getWorkerStatus never throws: null on error, invalid answer or offline', async () => {
    respond({ error: { code: 'parent_locked', message: 'Verrouillé' } }, 403);
    expect(await getWorkerStatus()).toBeNull();
    respond({ ...workerStatus, queued: { ai: -1, pageText: 0 } });
    expect(await getWorkerStatus()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    expect(await getWorkerStatus()).toBeNull();
    const calls = respond(workerStatus);
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    expect(await getWorkerStatus()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('relaunchTranscription posts the document (and optional pages) and returns the queued count', async () => {
    const calls = respond({ queued: 4 });
    expect(await relaunchTranscription('doc 1')).toEqual({ queued: 4 });
    expect(await relaunchTranscription('doc-2', [0, 3])).toEqual({ queued: 4 });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual(['POST /api/worker/transcriptions', 'POST /api/worker/transcriptions']);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ documentId: 'doc 1' });
    expect(JSON.parse(calls[1]?.init.body as string)).toEqual({ documentId: 'doc-2', pageIndexes: [0, 3] });
    expect((calls[0]?.init.headers as Record<string, string>)['X-Requested-With']).toBe('aide');
    expect(calls[0]?.init.credentials).toBe('include');
  });

  it('relaunchTranscription throws ApiError like the other wrappers', async () => {
    respond({ error: { code: 'parent_locked', message: 'Verrouillé' } }, 403);
    await expect(relaunchTranscription('doc-1')).rejects.toMatchObject({ name: 'ApiError', status: 403, code: 'parent_locked' });
    respond({ nothing: true });
    await expect(relaunchTranscription('doc-1')).rejects.toMatchObject({ code: 'invalid_response' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    await expect(relaunchTranscription('doc-1')).rejects.toMatchObject({ code: 'offline' });
  });
});
