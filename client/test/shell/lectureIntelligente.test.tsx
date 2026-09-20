// « Lecture intelligente » in the adult area: worker status on the Options page, relaunch and document type (§17.10) from the
// document detail page.
import { DEFAULT_PARENT_SETTINGS, type DocumentMeta, type PageContent, type ParentSettings, type WorkerStatus } from '@aide/shared';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { ToastProvider } from '../../src/design/components';
import { documents } from '../../src/i18n/fr/documents';
import { format } from '../../src/i18n/fr';
import { errors } from '../../src/i18n/fr/errors';
import { parent } from '../../src/i18n/fr/parent';
import { useSessionStore } from '../../src/state/session';
import { buttonByText, cleanup, click, render, waitFor } from './render';

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  putSettings: vi.fn(),
  getWorkerStatus: vi.fn(),
  relaunchTranscription: vi.fn(),
  setDocumentTextMode: vi.fn(),
  prepareReading: vi.fn(),
}));

vi.mock('../../src/api/settings', () => ({ getSettings: api.getSettings, putSettings: api.putSettings, getWorkerStatus: api.getWorkerStatus }));
vi.mock('../../src/api/worker', () => ({ relaunchTranscription: api.relaunchTranscription }));
vi.mock('../../src/api/documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/api/documents')>()),
  setDocumentTextMode: api.setDocumentTextMode,
  prepareReading: api.prepareReading,
}));

const { ApiError } = await import('../../src/api/http');
const { describeWorkerStatus } = await import('../../src/features/parent/workerStatus');
const { formatEuros } = await import('../../src/features/parent/format');
const AISettingsPage = (await import('../../src/features/parent/AISettingsPage')).default;
const DocumentDetailPage = (await import('../../src/features/parent/DocumentDetailPage')).default;

const w = parent.ai.worker;

function workerStatus(patch: Partial<WorkerStatus> = {}): WorkerStatus {
  return {
    configured: true, connected: true, lastSeenAt: null, limited: false, limitResetsAt: null, queued: { ai: 0, pageText: 0, pageSpeech: 0 },
    usage: null, estimate: { monthToDateEur: 0, allAccountsEur: null }, ...patch,
  };
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

async function renderRoute(path: string, pattern: string, element: ReactElement): Promise<HTMLElement> {
  const router = createMemoryRouter([{ path: pattern, element: <ToastProvider>{element}</ToastProvider> }], { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.clearAllMocks();
  setOnline(true);
  useSessionStore.setState({ ready: true, online: true, parentSettings: null });
});

afterEach(async () => {
  await cleanup();
});

afterAll(() => {
  db.close();
});

describe('describeWorkerStatus', () => {
  const now = new Date(2026, 8, 17, 10, 0).getTime();

  it('describes each state of the home computer', () => {
    expect(describeWorkerStatus(workerStatus({ configured: false, connected: false, queued: { ai: 2, pageText: 4, pageSpeech: 0 } }), now)).toEqual({
      tone: 'off',
      text: 'Ordinateur de la maison : non configuré',
      queued: [],
      subscription: null,
      estimate: [],
    });
    expect(describeWorkerStatus(workerStatus({ lastSeenAt: now - 10_000 }), now)).toMatchObject({ tone: 'ok', text: 'Ordinateur de la maison : connecté', queued: [] });
    expect(describeWorkerStatus(workerStatus({ connected: false, lastSeenAt: null }), now).text).toBe('Ordinateur de la maison : jamais vu');

    const offline = describeWorkerStatus(workerStatus({ connected: false, lastSeenAt: now - 5 * 60_000 }), now);
    expect(offline.tone).toBe('off');
    expect(offline.text).toBe('Ordinateur de la maison : hors ligne (vu pour la dernière fois il y a 5 minutes)');

    const limited = describeWorkerStatus(workerStatus({ limited: true, limitResetsAt: new Date(2026, 8, 17, 14, 30).getTime() }), now);
    expect(limited).toMatchObject({ tone: 'warn', text: 'Ordinateur de la maison : limite d’utilisation atteinte jusqu’à 14:30' });
    const later = describeWorkerStatus(workerStatus({ limited: true, limitResetsAt: new Date(2026, 8, 20, 9, 0).getTime() }), now);
    expect(later.text).toContain('20 sept.');
    expect(describeWorkerStatus(workerStatus({ limited: true }), now).text).toBe('Ordinateur de la maison : limite d’utilisation atteinte');
  });

  it('§21 shows the use of the subscription as last seen, and the estimate of the month', () => {
    const u = w.usage;
    const week = describeWorkerStatus(workerStatus({
      usage: { status: 'allowed_warning', window: 'week', utilization: 82.4, resetsAt: new Date(2026, 8, 17, 17, 0).getTime(), observedAt: now - 3 * 60_000 },
      estimate: { monthToDateEur: 3.2, allAccountsEur: 4.1 },
    }), now);
    expect(week.subscription).toEqual({
      tone: 'warn',
      text: 'Abonnement : 82 % utilisés sur la semaine',
      details: ['Remise à zéro : 17:00.', 'Mesuré il y a 3 minutes, à la fin de la dernière demande.'],
    });
    expect(week.estimate).toEqual([format(u.estimate, { amount: formatEuros(3.2) }), format(u.estimateAll, { amount: formatEuros(4.1) })]);
    expect(formatEuros(3.2)).toMatch(/^3,20\s€$/);

    const calm = describeWorkerStatus(workerStatus({ usage: { status: 'allowed', window: 'session', utilization: null, resetsAt: null, observedAt: now + 5_000 } }), now);
    expect(calm.subscription).toEqual({ tone: 'ok', text: 'Abonnement : marge confortable sur la session de 5 h', details: ['Mesuré maintenant, à la fin de la dernière demande.'] });
    expect(calm.estimate).toEqual([format(u.estimate, { amount: formatEuros(0) })]);

    const reached = describeWorkerStatus(workerStatus({ usage: { status: 'rejected', window: null, utilization: 100, resetsAt: now - 1, observedAt: null } }), now);
    expect(reached.subscription).toEqual({ tone: 'warn', text: 'Abonnement : limite atteinte sur la période en cours', details: [] });
    expect(describeWorkerStatus(workerStatus(), now).subscription).toEqual({ tone: 'off', text: u.none, details: [] });
  });

  it('lists the waiting pages and help requests', () => {
    expect(describeWorkerStatus(workerStatus({ queued: { ai: 1, pageText: 3, pageSpeech: 0 } }), now).queued).toEqual([
      '3 pages en attente de lecture intelligente',
      '1 demande d’aide en attente',
    ]);
    expect(describeWorkerStatus(workerStatus({ queued: { ai: 5, pageText: 1, pageSpeech: 0 } }), now).queued).toEqual([
      '1 page en attente de lecture intelligente',
      '5 demandes d’aide en attente',
    ]);
    expect(describeWorkerStatus(workerStatus({ queued: { ai: 0, pageText: 0, pageSpeech: 1 } }), now).queued).toEqual(['1 page à préparer pour la lecture à voix haute']);
    expect(describeWorkerStatus(workerStatus({ queued: { ai: 0, pageText: 0, pageSpeech: 4 } }), now).queued).toEqual(['4 pages à préparer pour la lecture à voix haute']);
  });
});

describe('Options page: lecture intelligente', () => {
  const settings = (patch: Partial<ParentSettings['privacy']> = {}): ParentSettings => ({
    ...DEFAULT_PARENT_SETTINGS,
    privacy: { ...DEFAULT_PARENT_SETTINGS.privacy, ...patch },
  });

  const aiSwitch = (container: HTMLElement): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]')).find((b) => b.textContent?.includes(parent.ai.aiTranscription));

  it('shows the switch, the worker state with waiting pages, and refreshes on demand', async () => {
    api.getSettings.mockResolvedValue(settings());
    api.getWorkerStatus.mockResolvedValueOnce(workerStatus({ queued: { ai: 0, pageText: 2, pageSpeech: 0 } })).mockResolvedValueOnce(null);
    const container = await renderRoute('/parent/ia', '/parent/ia', <AISettingsPage />);

    await waitFor(() => expect(container.textContent).toContain('Ordinateur de la maison : connecté'));
    expect(aiSwitch(container)?.getAttribute('aria-checked')).toBe('true');
    expect(aiSwitch(container)?.textContent).toContain(parent.ai.aiTranscriptionHint);
    expect(container.textContent).toContain('2 pages en attente de lecture intelligente');
    expect(container.querySelector('.form-notice')).toBeNull();

    await click(buttonByText(w.refresh, container));
    await waitFor(() => expect(container.textContent).toContain(w.unavailable));
    expect(api.getWorkerStatus).toHaveBeenCalledTimes(2);
  });

  it('§21 shows the use of the subscription and follows it every 30 s while the page is on screen', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      api.getSettings.mockResolvedValue(settings());
      const first = workerStatus({ usage: { status: 'allowed', window: 'week', utilization: 40, resetsAt: null, observedAt: null } });
      const later = workerStatus({ usage: { status: 'allowed_warning', window: 'week', utilization: 81, resetsAt: null, observedAt: null } });
      api.getWorkerStatus.mockResolvedValueOnce(first).mockResolvedValueOnce(later).mockResolvedValue(null);
      const container = await renderRoute('/parent/ia', '/parent/ia', <AISettingsPage />);
      await waitFor(() => expect(container.textContent).toContain('Abonnement : 40 % utilisés sur la semaine'));
      expect(container.textContent).not.toContain('tarif public');

      vi.advanceTimersByTime(30_000);
      await waitFor(() => expect(container.textContent).toContain('Abonnement : 81 % utilisés sur la semaine'));
      // A failed check in the background keeps the last figures.
      vi.advanceTimersByTime(30_000);
      await waitFor(() => expect(api.getWorkerStatus).toHaveBeenCalledTimes(3));
      expect(container.textContent).toContain('Abonnement : 81 % utilisés sur la semaine');
      expect(container.textContent).not.toContain(w.unavailable);
    } finally {
      vi.useRealTimers();
    }
  });

  it('warns when the page images or the text sync are off, and saves the switch', async () => {
    api.getSettings.mockResolvedValue(settings({ uploadPageImages: false }));
    api.getWorkerStatus.mockResolvedValue(workerStatus({ configured: false, connected: false }));
    api.putSettings.mockImplementation(async (value: ParentSettings) => value);
    const container = await renderRoute('/parent/ia', '/parent/ia', <AISettingsPage />);

    await waitFor(() => expect(container.querySelector('.form-notice')?.textContent).toContain(parent.ai.uploadPageImages));
    expect(container.querySelector('.form-notice')?.textContent).toContain(parent.ai.syncDocumentText);
    expect(container.textContent).toContain('Ordinateur de la maison : non configuré');

    await click(aiSwitch(container));
    expect(container.querySelector('.form-notice')).toBeNull();
    await click(buttonByText(parent.ai.save, container));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledTimes(1));
    expect(api.putSettings.mock.calls[0]?.[0]).toMatchObject({ ocr: { aiTranscription: false } });
  });
});

describe('document detail: §22 « Préparer la lecture à voix haute »', () => {
  const d = documents.detail;
  async function seed(spoken: (string | undefined)[]): Promise<string> {
    const id = 'doc-voice';
    await db.documents.put({
      id, ownerParentId: 'p1', childIds: [], title: 'Consignes', kind: 'images', textMode: 'faithful', purpose: 'reading', homeworkDoneAt: null, sourceHash: 'h', pageCount: 3, status: 'ready', createdAt: 1, updatedAt: 1, deletedAt: null,
    });
    const page = (pageIndex: number, prepared: string | undefined): PageContent => ({
      documentId: id, pageIndex, status: 'ready', textSource: 'ocr-ai', confidence: null, contentHash: null, width: 100, height: 100, warnings: [], updatedAt: 1,
      blocks: [{ kind: 'paragraph', text: '1: lis 2: écris', ...(prepared === undefined ? {} : { spoken: prepared }) }],
    });
    await db.pages.bulkPut([...spoken.map((prepared, i) => page(i, prepared)), { ...page(spoken.length, undefined), status: 'processing', blocks: [] }]);
    return id;
  }
  const open = (id: string): Promise<HTMLElement> => renderRoute(`/parent/documents/${id}`, '/parent/documents/:documentId', <DocumentDetailPage />);

  it('tells how many pages the voice reads prepared, and prepares the whole document', async () => {
    // A preparation that lost its words does not count.
    const id = await seed(['1. Lis. 2. Écris.', undefined, '1. Lis. 2. Dessine.']);
    api.prepareReading.mockResolvedValueOnce({ queued: 2, unavailable: null }).mockResolvedValueOnce({ queued: 0, unavailable: 'text_not_synced' });
    const container = await open(id);
    await waitFor(() => expect(container.textContent).toContain('Pages préparées pour la voix : 1 sur 3.'));

    await click(buttonByText(d.prepare, container));
    await waitFor(() => expect(document.body.textContent).toContain('2 pages envoyées à l’ordinateur de la maison.'));
    expect(api.prepareReading).toHaveBeenCalledWith(id, {});
    await click(buttonByText(d.prepare, container));
    await waitFor(() => expect(document.body.textContent).toContain(d.prepareUnavailable.text_not_synced));
  });

  it('offers to prepare again once every page is prepared', async () => {
    const id = await seed(['1. Lis. 2. Écris.']);
    api.prepareReading.mockResolvedValueOnce({ queued: 0, unavailable: null });
    const container = await open(id);
    await waitFor(() => expect(buttonByText(d.prepareAgain, container)).not.toBeNull());
    await click(buttonByText(d.prepareAgain, container));
    await waitFor(() => expect(api.prepareReading).toHaveBeenCalledWith(id, { force: true }));
    await waitFor(() => expect(document.body.textContent).toContain(d.prepareNone));
  });
});

describe('document detail: « Relancer la lecture intelligente »', () => {
  async function seed(kind: DocumentMeta['kind']): Promise<string> {
    const id = `doc-${kind}`;
    await db.documents.put({
      id, ownerParentId: 'p1', childIds: [], title: 'Sciences', kind, textMode: 'faithful', purpose: 'reading', homeworkDoneAt: null, sourceHash: 'h', pageCount: 2, status: 'partial', createdAt: 1, updatedAt: 1, deletedAt: null,
    });
    const base: PageContent = {
      documentId: id, pageIndex: 0, status: 'ready', textSource: 'ocr-local', blocks: [{ kind: 'paragraph', text: 'Le chat dort.' }],
      confidence: 90, contentHash: null, width: 100, height: 100, warnings: [], updatedAt: 1,
    };
    await db.pages.bulkPut([base, { ...base, pageIndex: 1, status: 'failed', textSource: null, blocks: [], confidence: null, warnings: ['awaiting_ai'] }]);
    return id;
  }

  const open = (id: string): Promise<HTMLElement> => renderRoute(`/parent/documents/${id}`, '/parent/documents/:documentId', <DocumentDetailPage />);

  it('sends the document again and tells how many pages left', async () => {
    const id = await seed('images');
    api.relaunchTranscription.mockResolvedValueOnce({ queued: 2 }).mockResolvedValueOnce({ queued: 0 });
    const container = await open(id);

    await waitFor(() => expect(buttonByText(documents.detail.relaunchAi, container)).not.toBeNull());
    // The waiting page is shown as waiting, not as a failure.
    expect(container.textContent).toContain(documents.awaitingAiStatus);

    await click(buttonByText(documents.detail.relaunchAi, container));
    await waitFor(() => expect(document.body.textContent).toContain('2 pages envoyées à la lecture intelligente.'));
    expect(api.relaunchTranscription).toHaveBeenCalledWith(id);

    await click(buttonByText(documents.detail.relaunchAi, container));
    await waitFor(() => expect(document.body.textContent).toContain(documents.detail.relaunchAiNone));
  });

  it('handles a locked adult area like the other parent actions', async () => {
    const id = await seed('pdf');
    const markParentLocked = vi.fn(async () => undefined);
    useSessionStore.setState({ markParentLocked });
    api.relaunchTranscription.mockRejectedValue(new ApiError(403, 'parent_locked', 'Verrouillé'));
    const container = await open(id);
    await waitFor(() => expect(buttonByText(documents.detail.relaunchAi, container)).not.toBeNull());
    await click(buttonByText(documents.detail.relaunchAi, container));
    await waitFor(() => expect(document.body.textContent).toContain(errors.codes.parent_locked));
    expect(markParentLocked).toHaveBeenCalledTimes(1);
  });

  it('explains a server without home computer (404)', async () => {
    const id = await seed('images');
    api.relaunchTranscription.mockRejectedValue(new ApiError(404, 'not_found', 'Introuvable'));
    const container = await open(id);
    await waitFor(() => expect(buttonByText(documents.detail.relaunchAi, container)).not.toBeNull());
    await click(buttonByText(documents.detail.relaunchAi, container));
    await waitFor(() => expect(document.body.textContent).toContain(documents.detail.relaunchAiUnavailable));
  });

  it('is disabled offline and hidden for an EPUB book', async () => {
    const id = await seed('images');
    setOnline(false);
    const container = await open(id);
    await waitFor(() => expect(buttonByText(documents.detail.relaunchAi, container)?.disabled).toBe(true));
    expect(container.textContent).toContain(documents.detail.relaunchAiOffline);
    await cleanup();

    setOnline(true);
    const epub = await seed('epub');
    const epubContainer = await open(epub);
    await waitFor(() => expect(epubContainer.textContent).toContain(documents.detail.filterAll));
    expect(buttonByText(documents.detail.relaunchAi, epubContainer)).toBeNull();
  });
});

describe('document detail: type de document (§17.10)', () => {
  const tm = documents.textMode;

  async function seed(kind: DocumentMeta['kind'], textMode: DocumentMeta['textMode'] = 'faithful'): Promise<DocumentMeta> {
    const doc: DocumentMeta = {
      id: `doc-${kind}-${textMode}`, ownerParentId: 'p1', childIds: [], title: 'Ma rédaction', kind, textMode, purpose: 'reading', homeworkDoneAt: null, sourceHash: 'h', pageCount: 1,
      status: 'ready', createdAt: 1, updatedAt: 1, deletedAt: null,
    };
    await db.documents.put(doc);
    await db.pages.put({
      documentId: doc.id, pageIndex: 0, status: 'ready', textSource: 'ocr-ai', blocks: [{ kind: 'paragraph', text: 'hier je suis allé au parc' }],
      confidence: null, contentHash: null, width: 100, height: 100, warnings: [], updatedAt: 1,
    });
    return doc;
  }

  const open = (id: string): Promise<HTMLElement> => renderRoute(`/parent/documents/${id}`, '/parent/documents/:documentId', <DocumentDetailPage />);

  it('shows the type; switching saves it on the server, updates this device and tells how many pages are read again', async () => {
    const doc = await seed('images');
    api.setDocumentTextMode.mockResolvedValue({ document: { ...doc, textMode: 'punctuated', updatedAt: 2 }, queued: 2 });
    const container = await open(doc.id);
    await waitFor(() => expect(container.textContent).toContain(format(tm.current, { mode: tm.faithful })));
    expect(container.textContent).toContain(tm.faithfulHint);

    await click(buttonByText(tm.switchToPunctuated, container));
    await waitFor(() => expect(document.body.textContent).toContain('2 pages envoyées à la lecture intelligente.'));
    expect(api.setDocumentTextMode).toHaveBeenCalledWith(doc.id, 'punctuated');
    expect((await db.documents.get(doc.id))?.textMode).toBe('punctuated');
    await waitFor(() => expect(container.textContent).toContain(format(tm.current, { mode: tm.punctuated })));
    expect(container.textContent).toContain(tm.punctuatedHint);
    expect(buttonByText(tm.switchToFaithful, container)).not.toBeNull();
    // Nothing is queued for the sync: the server already has the type.
    expect(await db.outbox.count()).toBe(0);
  });

  it('a device copy saved before document types existed is a book; a locked adult area is handled like the other actions', async () => {
    const doc = await seed('pdf');
    const { textMode: _older, ...withoutMode } = doc;
    await db.documents.put(withoutMode as DocumentMeta);
    const markParentLocked = vi.fn(async () => undefined);
    useSessionStore.setState({ markParentLocked });
    api.setDocumentTextMode.mockRejectedValue(new ApiError(403, 'parent_locked', 'Verrouillé'));
    const container = await open(doc.id);
    await waitFor(() => expect(container.textContent).toContain(format(tm.current, { mode: tm.faithful })));
    await click(buttonByText(tm.switchToPunctuated, container));
    await waitFor(() => expect(document.body.textContent).toContain(errors.codes.parent_locked));
    expect(markParentLocked).toHaveBeenCalledTimes(1);
    expect((await db.documents.get(doc.id))?.textMode).toBeUndefined();
  });

  it('warns when the lecture intelligente is off, needs a connection and is hidden for an EPUB book', async () => {
    const child = await seed('images', 'punctuated');
    const off: ParentSettings = { ...DEFAULT_PARENT_SETTINGS, ocr: { ...DEFAULT_PARENT_SETTINGS.ocr, aiTranscription: false } };
    useSessionStore.setState({ parentSettings: off });
    setOnline(false);
    const container = await open(child.id);
    await waitFor(() => expect(container.textContent).toContain(tm.needsAi));
    expect(buttonByText(tm.switchToFaithful, container)?.disabled).toBe(true);
    expect(container.textContent).toContain(tm.offline);
    await cleanup();

    setOnline(true);
    const epub = await seed('epub');
    const epubContainer = await open(epub.id);
    await waitFor(() => expect(epubContainer.textContent).toContain(documents.detail.filterAll));
    expect(epubContainer.textContent).not.toContain(tm.label);
  });
});
