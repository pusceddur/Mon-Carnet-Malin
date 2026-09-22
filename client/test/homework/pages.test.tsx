// « Mes devoirs » pages (§19.3): add a sheet, lists, the sheet page with « J'ai terminé » and « Envoyer ou imprimer ».
import type { ChildProfile, DocumentMeta } from '@aide/shared';
import { act, type JSX } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { ToastProvider } from '../../src/design/components';
import { format } from '../../src/i18n/fr';
import { homework as h } from '../../src/i18n/fr/homework';
import { useSessionStore } from '../../src/state/session';
import { buttonByText, cleanup, click, render, waitFor } from '../shell/render';

const mocks = vi.hoisted(() => ({
  importFiles: vi.fn(),
  exportHomework: vi.fn(),
  shareFile: vi.fn(),
  downloadFile: vi.fn(),
  canShareFile: vi.fn(),
}));

vi.mock('../../src/documents/ImportService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/documents/ImportService')>()),
  importFiles: mocks.importFiles,
}));
vi.mock('../../src/features/homework/exportHomework', () => ({
  exportHomework: mocks.exportHomework,
  shareFile: mocks.shareFile,
  downloadFile: mocks.downloadFile,
  canShareFile: mocks.canShareFile,
}));
// The page image and its tools are tested with the reader; here only what the sheet page passes to it.
vi.mock('../../src/features/reader/OriginalPageView', () => ({
  OriginalPageView: (props: { pageIndex: number; startWriting?: boolean }): JSX.Element => (
    <div data-testid="original" data-page={props.pageIndex} data-writing={String(props.startWriting)} />
  ),
}));
vi.mock('../../src/sync/SyncEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/SyncEngine')>()),
  saveEntity: async (table: string, entity: unknown) => {
    const { db: localDb } = await import('../../src/db/localDb');
    await localDb.table(table).put(entity);
  },
}));

const HomeworkListPage = (await import('../../src/features/homework/HomeworkListPage')).default;
const HomeworkPage = (await import('../../src/features/homework/HomeworkPage')).default;

const CHILD = { id: 'c1', nickname: 'Léo', avatar: '🦊', deletedAt: null } as unknown as ChildProfile;

function sheet(patch: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    id: 'sheet-1', ownerParentId: 'p1', childIds: ['c1'], title: 'Fiche de maths', kind: 'images', textMode: 'faithful', purpose: 'homework',
    homeworkDoneAt: null, sourceHash: 'h', pageCount: 2, status: 'ready', createdAt: Date.UTC(2026, 8, 18), updatedAt: 1, deletedAt: null, ...patch,
  };
}

async function open(path: string): Promise<HTMLElement> {
  const router = createMemoryRouter(
    [
      { path: '/devoirs', element: <ToastProvider><HomeworkListPage /></ToastProvider> },
      { path: '/devoirs/:documentId', element: <ToastProvider><HomeworkPage /></ToastProvider> },
      { path: '/lire/:documentId', element: <p>lecteur</p> },
      { path: '/accueil', element: <p>accueil</p> },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

async function chooseFiles(container: HTMLElement, files: File[]): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.clearAllMocks();
  useSessionStore.setState({ ready: true, online: true, children: [CHILD], selectedChildId: 'c1' } as never);
});

afterEach(async () => {
  await cleanup();
});

afterAll(() => {
  db.close();
});

describe('« Mes devoirs » (§19.3)', () => {
  it('a sheet chosen by the child becomes a homework of this child and opens for writing', async () => {
    mocks.importFiles.mockImplementation(async () => {
      await db.documents.put(sheet({ id: 'new-sheet' }));
      return 'new-sheet';
    });
    const container = await open('/devoirs');
    await waitFor(() => expect(container.textContent).toContain(h.emptyTitle));
    await chooseFiles(container, [new File(['x'], 'IMG_1.jpg', { type: 'image/jpeg' })]);
    await waitFor(() => expect(mocks.importFiles).toHaveBeenCalledTimes(1));
    const options = mocks.importFiles.mock.calls[0]![1] as { title: string; childIds: string[]; purpose: string };
    expect(options).toMatchObject({ childIds: ['c1'], purpose: 'homework' });
    expect(options.title).toMatch(/^Devoir du \d{1,2} \p{L}+$/u);
    await waitFor(() => expect(container.querySelector('[data-testid="original"]')).not.toBeNull());
  });

  it('lists the homework to do and done; an EPUB is refused', async () => {
    await db.documents.bulkPut([
      sheet(),
      sheet({ id: 'sheet-2', title: 'Dictée', homeworkDoneAt: Date.UTC(2026, 8, 17) }),
      sheet({ id: 'book', title: 'Le Petit Prince', purpose: 'reading' }),
    ]);
    const container = await open('/devoirs');
    await waitFor(() => expect(container.textContent).toContain('Fiche de maths'));
    expect(container.textContent).toContain(h.todo);
    expect(container.textContent).toContain(h.done);
    expect(container.textContent).toContain(format(h.doneOn, { date: '17 septembre' }));
    expect(container.textContent).not.toContain('Le Petit Prince');

    await chooseFiles(container, [new File(['x'], 'livre.epub', { type: 'application/epub+zip' })]);
    expect(mocks.importFiles).not.toHaveBeenCalled();
  });

  it('the sheet page: writing on by default, pages, « J’ai terminé » and back, read the text', async () => {
    await db.documents.put(sheet());
    const container = await open('/devoirs/sheet-1');
    await waitFor(() => expect(container.querySelector('[data-testid="original"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="original"]')!.getAttribute('data-writing')).toBe('true');
    expect(container.textContent).toContain(format(h.pageOf, { page: 1, total: 2 }));
    await click(container.querySelector(`button[aria-label="${h.nextPage}"]`));
    expect(container.querySelector('[data-testid="original"]')!.getAttribute('data-page')).toBe('1');

    await click(buttonByText(h.finish, container));
    await waitFor(async () => expect((await db.documents.get('sheet-1'))?.homeworkDoneAt).not.toBeNull());
    await waitFor(() => expect(buttonByText(h.reopen, container)).not.toBeNull());
    await click(buttonByText(h.reopen, container));
    await waitFor(async () => expect((await db.documents.get('sheet-1'))?.homeworkDoneAt).toBeNull());

    await click(buttonByText(h.readText, container));
    await waitFor(() => expect(container.textContent).toContain('lecteur'));
  });

  it('« Envoyer ou imprimer »: the PDF is prepared first, then a second tap shares it (or downloads it)', async () => {
    await db.documents.put(sheet());
    const pdf = new File(['%PDF'], 'Fiche de maths.pdf', { type: 'application/pdf' });
    mocks.exportHomework.mockResolvedValue(pdf);
    mocks.canShareFile.mockReturnValue(true);
    mocks.shareFile.mockResolvedValue(false);
    const container = await open('/devoirs/sheet-1');
    await waitFor(() => expect(buttonByText(h.share, container)).not.toBeNull());
    await click(buttonByText(h.share, container));
    await waitFor(() => expect(document.body.textContent).toContain(h.shareReady));
    expect(mocks.exportHomework).toHaveBeenCalledWith(expect.objectContaining({ id: 'sheet-1' }), 'c1');
    expect(mocks.shareFile).not.toHaveBeenCalled();

    await click(buttonByText(h.share, container));
    await waitFor(() => expect(mocks.shareFile).toHaveBeenCalledWith(pdf, 'Fiche de maths'));
    // Sharing refused by the browser: the file is downloaded instead.
    await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledWith(pdf));
  });

  it('a sheet of another child, a book or a deleted document is not found', async () => {
    await db.documents.bulkPut([sheet({ id: 'other', childIds: ['c2'] }), sheet({ id: 'book', purpose: 'reading' })]);
    for (const id of ['other', 'book', 'missing']) {
      const container = await open(`/devoirs/${id}`);
      await waitFor(() => expect(container.textContent).toContain(h.notFound));
      await cleanup();
    }
  });
});
