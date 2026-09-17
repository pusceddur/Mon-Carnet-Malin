import { expect, test } from '@playwright/test';
import type { PageContent } from '@aide/shared';
import { ensureChild, importDocument, openBooksAs, readLocalTable, signIn, trackPageErrors } from './support/app';
import { makeTextPng, PAGE_ONE, PAGE_TWO } from './support/fixtures';

const CHILD = 'Léa';
const BOOK = 'Photos – Le volcan';

/** Lower-case text without accents, for OCR-tolerant comparisons. */
const plain = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

test('photos of pages become readable one by one through on-device OCR', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const pageErrors = trackPageErrors(page);

  await signIn(page);
  await ensureChild(page, CHILD);
  const [one, two] = await Promise.all([makeTextPng(browser, PAGE_ONE), makeTextPng(browser, PAGE_TWO)]);
  await importDocument(page, BOOK, [
    { name: 'page-1.png', mimeType: 'image/png', buffer: one },
    { name: 'page-2.png', mimeType: 'image/png', buffer: two },
  ], 2);

  // The child opens the book right away: pages appear as soon as each one is ready.
  await openBooksAs(page, CHILD);
  await page.getByRole('button', { name: new RegExp(BOOK) }).first().click();
  await page.waitForURL(/\/lire\//);
  const documentId = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() ?? '');

  const firstPage = page.locator('.rp-page[data-page-index="0"]');
  await expect.poll(async () => plain((await firstPage.textContent()) ?? ''), { timeout: 180_000, intervals: [1_000] }).toContain('la lave coulait');
  expect(plain((await firstPage.textContent()) ?? '')).toContain('volcan');

  await expect
    .poll(async () => {
      const pages = (await readLocalTable<PageContent>(page, 'pages')).filter((p) => p.documentId === documentId);
      return pages.map((p) => `${p.pageIndex}:${p.status}`).sort().join(',');
    }, { timeout: 180_000, intervals: [1_000] })
    .toMatch(/^0:(ready|low_confidence),1:(ready|low_confidence)$/);

  const pages = (await readLocalTable<PageContent>(page, 'pages')).filter((p) => p.documentId === documentId);
  for (const p of pages) {
    expect(p.textSource === 'ocr-local' || p.textSource === 'ocr-server').toBe(true);
    expect(p.confidence).not.toBeNull();
    expect(p.blocks.length).toBeGreaterThan(0);
  }
  // Layout: one title and one block per printed paragraph (not a single wall of text).
  const first = pages.find((p) => p.pageIndex === 0)!;
  expect(first.blocks.map((b) => b.kind)).toEqual(['title', ...PAGE_ONE.paragraphs.map(() => 'paragraph')]);

  await page.getByRole('button', { name: 'Page suivante' }).first().click();
  await expect(page.getByText('Page 2 / 2').first()).toBeVisible();
  await expect.poll(async () => plain((await page.locator('.rp-page[data-page-index="1"]').textContent()) ?? '')).toContain('maitresse');

  expect(pageErrors).toEqual([]);
});
