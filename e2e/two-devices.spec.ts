import { expect, test } from '@playwright/test';
import type { SyncResponse } from '@aide/shared';
import { ensureChild, importDocument, openBooksAs, signIn, trackPageErrors } from './support/app';
import { makeTextPdf, PAGE_ONE } from './support/fixtures';

const CHILD = 'Léa';
const BOOK = 'Deux iPad – Le volcan';

test('a second device receives the book, its text and the child’s highlight through sync', async ({ page, browser }) => {
  const errorsA = trackPageErrors(page);

  await test.step('device A: import, then the child highlights a word', async () => {
    await signIn(page);
    await ensureChild(page, CHILD);
    await importDocument(page, BOOK, [{ name: 'deux.pdf', mimeType: 'application/pdf', buffer: await makeTextPdf(browser) }], 2);
    await openBooksAs(page, CHILD);
    await page.getByRole('button', { name: new RegExp(BOOK) }).first().click();
    const word = page.locator('.rp-page[data-page-index="0"] .rp-w', { hasText: /^montagne$/ }).first();
    await word.tap();
    await page.getByRole('button', { name: /Surligner/ }).click();
    await expect(page.locator('.rp-page[data-page-index="0"] .rp-w[data-hl]')).toHaveText(['montagne']);

    await expect
      .poll(async () => {
        const res = await page.request.post('/api/sync', {
          headers: { 'X-Requested-With': 'aide' },
          data: { cursor: null, deviceId: 'e2e-probe', changes: { documents: [], pages: [], annotations: [], progress: [], sessions: [], exercises: [], answers: [], children: [] } },
        });
        const changes = ((await res.json()) as SyncResponse).changes;
        const doc = changes.documents.find((d) => d.title === BOOK);
        return changes.annotations.some((a) => a.type === 'highlight' && a.documentId === doc?.id && a.text === 'montagne');
      }, { timeout: 30_000, intervals: [1_000] })
      .toBe(true);
  });

  await test.step('device B: sign in and read the same page with the highlight', async () => {
    const deviceB = await browser.newContext({ ...test.info().project.use });
    const pageB = await deviceB.newPage();
    const errorsB = trackPageErrors(pageB);
    try {
      await signIn(pageB);
      await openBooksAs(pageB, CHILD);
      await expect(pageB.getByRole('button', { name: new RegExp(BOOK) }).first()).toBeVisible({ timeout: 30_000 });
      await pageB.getByRole('button', { name: new RegExp(BOOK) }).first().click();
      await expect(pageB.locator('.rp-page[data-page-index="0"]')).toContainText(PAGE_ONE.title, { timeout: 30_000 });
      await expect(pageB.locator('.rp-page[data-page-index="0"] .rp-w[data-hl]')).toHaveText(['montagne'], { timeout: 30_000 });
      expect(errorsB).toEqual([]);
    } finally {
      await deviceB.close();
    }
  });

  expect(errorsA).toEqual([]);
});
