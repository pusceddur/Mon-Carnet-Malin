// Import page: « Type de document » (§17.10).
import { DEFAULT_PARENT_SETTINGS, type AuthStatus, type ParentSettings } from '@aide/shared';
import { act } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../src/design/components';
import { documents } from '../../src/i18n/fr/documents';
import { useSessionStore } from '../../src/state/session';
import { buttonByText, cleanup, click, render, waitFor } from '../shell/render';

const mocks = vi.hoisted(() => ({ importFiles: vi.fn(), analyzeFile: vi.fn() }));

vi.mock('../../src/documents/ImportService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/documents/ImportService')>()),
  importFiles: mocks.importFiles,
  analyzeFile: mocks.analyzeFile,
}));

const ImportPage = (await import('../../src/features/parent/ImportPage')).default;
const tm = documents.textMode;
const t = documents.importPage;

async function open(): Promise<HTMLElement> {
  const router = createMemoryRouter(
    [
      { path: '/parent/importer', element: <ToastProvider><ImportPage /></ToastProvider> },
      { path: '/parent/documents', element: <p>liste</p> },
    ],
    { initialEntries: ['/parent/importer'] },
  );
  return render(<RouterProvider router={router} />);
}

/** Same as choosing files in the « Choisir des fichiers » picker. */
async function chooseFiles(container: HTMLElement, files: File[]): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]');
  if (!input) throw new Error('file input missing');
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const photo = (): File => new File(['photo'], 'redaction.jpg', { type: 'image/jpeg' });
// jsdom has no object URLs (image previews).
const objectUrls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:apercu'), revokeObjectURL: vi.fn() });
  mocks.importFiles.mockResolvedValue('doc-1');
  useSessionStore.setState({ ready: true, online: true, children: [], parentSettings: null });
});

afterEach(async () => {
  await cleanup();
  Object.assign(URL, objectUrls);
});

describe('import page: type de document (§17.10)', () => {
  it('is asked for photos and PDF; a text written by a child is imported in the punctuated mode', async () => {
    useSessionStore.setState({ authStatus: { aiReading: true } as AuthStatus });
    const container = await open();
    await chooseFiles(container, [photo()]);
    await waitFor(() => expect(container.textContent).toContain(tm.label));
    expect(container.textContent).toContain(tm.faithfulHint);

    await click(buttonByText(tm.punctuated, container));
    expect(container.textContent).toContain(tm.punctuatedHint);
    expect(container.textContent).toContain(tm.punctuatedWaits);

    await click(buttonByText(t.submit, container));
    await waitFor(() => expect(mocks.importFiles).toHaveBeenCalledTimes(1));
    expect(mocks.importFiles.mock.calls[0]?.[1]).toMatchObject({ textMode: 'punctuated' });
  });

  it('« C’est un devoir à compléter » imports a homework sheet, kept as printed (§19.3)', async () => {
    const container = await open();
    await chooseFiles(container, [photo()]);
    await waitFor(() => expect(container.textContent).toContain(t.homeworkLabel));
    await click(Array.from(container.querySelectorAll('[role="switch"]')).find((el) => el.textContent?.includes(t.homeworkLabel)));
    // A homework sheet has no « Texte écrit par un enfant » choice.
    await waitFor(() => expect(container.textContent).not.toContain(tm.label));
    await click(buttonByText(t.submit, container));
    await waitFor(() => expect(mocks.importFiles).toHaveBeenCalledTimes(1));
    expect(mocks.importFiles.mock.calls[0]?.[1]).toMatchObject({ purpose: 'homework', textMode: 'faithful' });
  });

  it('warns when the lecture intelligente is off; an EPUB alone has no type to choose and stays faithful', async () => {
    const off: ParentSettings = { ...DEFAULT_PARENT_SETTINGS, ocr: { ...DEFAULT_PARENT_SETTINGS.ocr, aiTranscription: false } };
    useSessionStore.setState({ parentSettings: off });
    const container = await open();
    await chooseFiles(container, [photo()]);
    await waitFor(() => expect(buttonByText(tm.punctuated, container)).not.toBeNull());
    await click(buttonByText(tm.punctuated, container));
    expect(container.textContent).toContain(tm.needsAi);
    await cleanup();

    mocks.analyzeFile.mockResolvedValue({ kind: 'epub', pageCount: 3, title: 'Le Renard' });
    const epubPage = await open();
    await chooseFiles(epubPage, [new File(['epub'], 'renard.epub', { type: 'application/epub+zip' })]);
    await waitFor(() => expect(epubPage.textContent).toContain('3 page(s)'));
    expect(epubPage.textContent).not.toContain(tm.label);
    await click(buttonByText(t.submit, epubPage));
    await waitFor(() => expect(mocks.importFiles).toHaveBeenCalledTimes(1));
    expect(mocks.importFiles.mock.calls[0]?.[1]).toMatchObject({ textMode: 'faithful', title: 'Le Renard' });
  });
});
