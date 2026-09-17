// « Lecture intelligente » in the adult area: worker status on the Options page, relaunch from the document detail page.
import { DEFAULT_PARENT_SETTINGS, type DocumentMeta, type PageContent, type ParentSettings, type WorkerStatus } from '@aide/shared';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { ToastProvider } from '../../src/design/components';
import { documents } from '../../src/i18n/fr/documents';
import { errors } from '../../src/i18n/fr/errors';
import { parent } from '../../src/i18n/fr/parent';
import { useSessionStore } from '../../src/state/session';
import { buttonByText, cleanup, click, render, waitFor } from './render';

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  putSettings: vi.fn(),
  getWorkerStatus: vi.fn(),
  relaunchTranscription: vi.fn(),
}));

vi.mock('../../src/api/settings', () => ({ getSettings: api.getSettings, putSettings: api.putSettings, getWorkerStatus: api.getWorkerStatus }));
vi.mock('../../src/api/worker', () => ({ relaunchTranscription: api.relaunchTranscription }));

const { ApiError } = await import('../../src/api/http');
const { describeWorkerStatus } = await import('../../src/features/parent/workerStatus');
const AISettingsPage = (await import('../../src/features/parent/AISettingsPage')).default;
const DocumentDetailPage = (await import('../../src/features/parent/DocumentDetailPage')).default;

const w = parent.ai.worker;

function workerStatus(patch: Partial<WorkerStatus> = {}): WorkerStatus {
  return { configured: true, connected: true, lastSeenAt: null, limited: false, limitResetsAt: null, queued: { ai: 0, pageText: 0 }, ...patch };
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
    expect(describeWorkerStatus(workerStatus({ configured: false, connected: false, queued: { ai: 2, pageText: 4 } }), now)).toEqual({
      tone: 'off',
      text: 'Ordinateur de la maison : non configuré',
      queued: [],
    });
    expect(describeWorkerStatus(workerStatus({ lastSeenAt: now - 10_000 }), now)).toEqual({ tone: 'ok', text: 'Ordinateur de la maison : connecté', queued: [] });
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

  it('lists the waiting pages and help requests', () => {
    expect(describeWorkerStatus(workerStatus({ queued: { ai: 1, pageText: 3 } }), now).queued).toEqual([
      '3 pages en attente de lecture intelligente',
      '1 demande d’aide en attente',
    ]);
    expect(describeWorkerStatus(workerStatus({ queued: { ai: 5, pageText: 1 } }), now).queued).toEqual([
      '1 page en attente de lecture intelligente',
      '5 demandes d’aide en attente',
    ]);
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
    api.getWorkerStatus.mockResolvedValueOnce(workerStatus({ queued: { ai: 0, pageText: 2 } })).mockResolvedValueOnce(null);
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

describe('document detail: « Relancer la lecture intelligente »', () => {
  async function seed(kind: DocumentMeta['kind']): Promise<string> {
    const id = `doc-${kind}`;
    await db.documents.put({
      id, ownerParentId: 'p1', childIds: [], title: 'Sciences', kind, sourceHash: 'h', pageCount: 2, status: 'partial', createdAt: 1, updatedAt: 1, deletedAt: null,
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
