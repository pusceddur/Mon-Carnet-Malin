import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/api/http';
import { db } from '../src/db/localDb';
import { format, fr } from '../src/i18n/fr';

describe('client foundations', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    db.close();
  });

  it('opens the Dexie database with every table of §10 (fake-indexeddb)', async () => {
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'aiCache', 'annotations', 'answers', 'children', 'dictionaryCache', 'documentFiles', 'documents', 'exercises', 'glossary',
      'jobs', 'kv', 'outbox', 'pageImages', 'pages', 'progress', 'sessions',
    ]);
    await db.kv.put({ key: 'deviceId', value: 'abc' });
    expect((await db.kv.get('deviceId'))?.value).toBe('abc');
    await db.pages.put({
      documentId: 'd1', pageIndex: 0, status: 'pending', textSource: null, blocks: [], confidence: null, contentHash: null,
      width: null, height: null, warnings: [], updatedAt: 1,
    });
    expect(await db.pages.get(['d1', 0])).toBeDefined();
    const seq = await db.outbox.add({ table: 'pages', entityId: 'd1:0', queuedAt: 1 });
    expect(typeof seq).toBe('number');
  });

  it('i18n aggregates all areas and formats placeholders', () => {
    expect(Object.keys(fr).sort()).toEqual(
      ['common', 'documents', 'errors', 'exercises', 'help', 'home', 'homework', 'library', 'notes', 'parent', 'pencil', 'question', 'reader', 'tts'],
    );
    expect(format('Bonjour {prenom} !', { prenom: 'Léo' })).toBe('Bonjour Léo !');
    expect(format('Page {n} / {total}', { n: 3 })).toBe('Page 3 / {total}');
  });

  it('api() parses heartbeat JSON, maps ApiErrorBody and network errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('   \n  {"ok":true}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'parent_locked', message: 'Verrouillé' } }), { status: 403 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api<{ ok: boolean }>('POST', '/api/x', { a: 1 })).resolves.toEqual({ ok: true });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('aide');
    expect(init.credentials).toBe('include');

    await expect(api('GET', '/api/y')).rejects.toMatchObject({ status: 403, code: 'parent_locked', message: 'Verrouillé' });
    const offline = await api('GET', '/api/z').catch((e: unknown) => e);
    expect(offline).toBeInstanceOf(ApiError);
    expect((offline as ApiError).code).toBe('offline');
  });

  it('declares every route of §11.1 (TSX module loads)', async () => {
    const { routes } = await import('../src/routes');
    const paths = routes.map((r) => r.path);
    expect(paths).toEqual(expect.arrayContaining([
      '/', '/installation', '/connexion', '/inscription', '/enfant', '/accueil', '/livres', '/lire/:documentId', '/exercices',
      '/exercices/:documentId/resume', '/exercices/:documentId/questions', '/exercices/quiz/:exerciseId', '/notes', '/question', '/parent',
    ]));
    const parentChildren = routes.find((r) => r.path === '/parent')?.children?.map((c) => c.path).filter(Boolean);
    expect(parentChildren).toEqual([
      'documents', 'importer', 'documents/:documentId', 'documents/:documentId/pages/:pageIndex', 'enfants', 'enfants/:childId',
      'ia', 'activite', 'glossaire', 'synchronisation', 'compte', 'diagnostic',
    ]);
  });

  it('api() reports timeout', async () => {
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    await expect(api('GET', '/api/slow', undefined, { timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  });
});
