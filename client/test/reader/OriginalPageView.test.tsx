// Original view: color copy of the page (§19.1), « Écrire du texte » (§19.2), image shown once the page is processed.
import type { PageContent } from '@aide/shared';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type PageImageRecord } from '../../src/db/localDb';
import { pencil as pencilStrings } from '../../src/i18n/fr/pencil';
import { resetPencilStore, usePencilStore } from '../../src/pencil/store';
import { cleanup, click, render, waitFor } from '../shell/render';

vi.mock('../../src/api/documents', () => ({ fetchPageImage: vi.fn(async () => null) }));
vi.mock('../../src/platform/online', () => ({ isOnline: () => false, useOnlineStatus: () => false }));

const { OriginalPageView } = await import('../../src/features/reader/OriginalPageView');

const COLOR = new Blob(['color'], { type: 'image/jpeg' });
const GRAY = new Blob(['gray'], { type: 'image/jpeg' });

function pageRow(width: number | null): PageContent {
  return {
    documentId: 'doc-1', pageIndex: 0, status: width === null ? 'pending' : 'ready', textSource: null, blocks: [], confidence: null, contentHash: null,
    width, height: width === null ? null : 1400, warnings: [], updatedAt: 1,
  };
}

let records: Partial<Record<PageImageRecord['variant'], PageImageRecord>> = {};
const objectUrls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };

beforeEach(() => {
  records = {};
  resetPencilStore();
  // fake-indexeddb does not keep Blobs: the records are served directly.
  vi.spyOn(db.pageImages, 'get').mockImplementation((async (key: [string, number, PageImageRecord['variant']]) => records[key[2]]) as never);
  Object.assign(URL, { createObjectURL: (blob: Blob) => (blob === COLOR ? 'blob:color' : 'blob:gray'), revokeObjectURL: () => undefined });
});

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  Object.assign(URL, objectUrls);
});

const view = (page: PageContent | null) => (
  <OriginalPageView documentId="doc-1" childId="child-1" pageIndex={0} page={page} layoutKey="k" />
);

describe('original view', () => {
  it('shows the color copy of the page, or the grayscale page processed before it existed (§19.1)', async () => {
    records = { color: { documentId: 'doc-1', pageIndex: 0, variant: 'color', blob: COLOR, width: 1000, height: 1400 }, ocr: { documentId: 'doc-1', pageIndex: 0, variant: 'ocr', blob: GRAY, width: 2000, height: 2800 } };
    const colored = await render(view(pageRow(2000)));
    await waitFor(() => expect(colored.querySelector('img')?.getAttribute('src')).toBe('blob:color'));
    expect(colored.querySelector('img')?.getAttribute('width')).toBe('1000');
    await cleanup();

    records = { ocr: { documentId: 'doc-1', pageIndex: 0, variant: 'ocr', blob: GRAY, width: 2000, height: 2800 } };
    const gray = await render(view(pageRow(2000)));
    await waitFor(() => expect(gray.querySelector('img')?.getAttribute('src')).toBe('blob:gray'));
  });

  it('a sheet opened before its first page is ready shows the image as soon as the page is processed', async () => {
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const show = (page: PageContent): Promise<void> => act(async () => root.render(view(page)));
    await show(pageRow(null));
    await waitFor(() => expect(container.textContent).toContain('Image non disponible'));

    records = { color: { documentId: 'doc-1', pageIndex: 0, variant: 'color', blob: COLOR, width: 1000, height: 1400 } };
    await show(pageRow(1000));
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:color'));
    await act(async () => root.unmount());
    container.remove();
  });

  it('« Écrire du texte » is a separate tool: taking a pencil turns it off (§19.2)', async () => {
    records = { color: { documentId: 'doc-1', pageIndex: 0, variant: 'color', blob: COLOR, width: 1000, height: 1400 } };
    // jsdom measures nothing: the page frame is 1000 px wide here.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 1400, right: 1000, bottom: 1400, toJSON: () => ({}) } as DOMRect);
    const container = await render(view(pageRow(1000)));
    const selector = `button[aria-label="${pencilStrings.textBox.tool}"]`;
    await waitFor(() => expect(container.querySelector(selector)).not.toBeNull());
    const tool = container.querySelector<HTMLButtonElement>(selector)!;
    await act(async () => usePencilStore.getState().setMode('annotation'));
    await click(tool);
    expect(usePencilStore.getState().mode).toBe('lecture');
    expect(container.textContent).toContain(pencilStrings.textBox.toolHint);
    expect(container.querySelector('.tb-layer--editing')).not.toBeNull();

    await act(async () => usePencilStore.getState().setMode('annotation'));
    expect(container.textContent).not.toContain(pencilStrings.textBox.toolHint);
    expect(container.querySelector('.tb-layer--editing')).toBeNull();
  });
});
