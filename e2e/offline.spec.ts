import { expect, test } from '@playwright/test';
import { ensureChild, importDocument, openBooksAs, signIn, trackPageErrors } from './support/app';
import { makeTextPdf, PAGE_ONE } from './support/fixtures';

// The real service worker is needed here (other specs block it).
test.use({ serviceWorkers: 'allow' });

const CHILD = 'Léa';
const BOOK = 'Hors ligne – Le volcan';

test('offline: the installed app restarts without network and the child reads an imported book', async ({ page, context, browser }) => {
  const pageErrors = trackPageErrors(page);
  await signIn(page);
  await ensureChild(page, CHILD);
  await importDocument(page, BOOK, [{ name: 'hors-ligne.pdf', mimeType: 'application/pdf', buffer: await makeTextPdf(browser) }], 2);
  await expect(page.locator('li', { hasText: BOOK })).toContainText('Prêt', { timeout: 30_000 });
  await openBooksAs(page, CHILD);

  // The service worker has installed and precached the app shell and every page chunk.
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await new Promise<void>((resolve) => {
      const worker = registration.active;
      if (worker?.state === 'activated') resolve();
      else worker?.addEventListener('statechange', () => worker.state === 'activated' && resolve());
    });
  });

  await context.setOffline(true);
  try {
    await page.goto('/accueil');
    await expect(page.getByRole('heading', { name: new RegExp(`Bonjour ${CHILD}`) })).toBeVisible();
    await page.getByRole('button', { name: /Mes livres/ }).click();
    await page.getByRole('button', { name: new RegExp(BOOK) }).first().click();
    await expect(page.locator('.rp-page[data-page-index="0"]')).toContainText(PAGE_ONE.title);
    await expect(page.locator('.rp-page[data-page-index="0"]')).toContainText('La lave coulait lentement sur la pente nord');

    // Section 25.1: nothing is answered on the device any more, so offline the child is told so plainly and
    // goes on reading. What matters here is that the app stays usable, not that it invents an answer.
    await page.locator('.rp-page[data-page-index="0"] .rp-w', { hasText: /^volcan$/ }).first().tap();
    await page.getByRole('button', { name: /Définition/ }).click();
    await expect(page.getByRole('dialog')).toContainText('Pas de connexion');
  } finally {
    await context.setOffline(false);
  }
  expect(pageErrors).toEqual([]);
});
