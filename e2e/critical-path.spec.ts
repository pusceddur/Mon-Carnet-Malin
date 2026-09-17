import { expect, test } from '@playwright/test';
import type { Exercise, InkAnnotation, SyncResponse } from '@aide/shared';
import {
  completeSetup, ensureChild, importDocument, login, openBooksAs, openParentArea, penStroke, readLocalTable, trackPageErrors,
} from './support/app';
import { makeTextPdf, PAGE_ONE } from './support/fixtures';

const CHILD = 'Léa';
const BOOK = 'Sciences – Le volcan';
const EMPTY_CHANGES = { documents: [], pages: [], annotations: [], progress: [], sessions: [], exercises: [], answers: [], children: [] };

/** Everything the server holds for this parent (pull from cursor 0 with an empty push). */
async function serverChanges(page: import('@playwright/test').Page): Promise<SyncResponse['changes']> {
  const res = await page.request.post('/api/sync', {
    headers: { 'X-Requested-With': 'aide' },
    data: { cursor: null, deviceId: 'e2e-probe', changes: EMPTY_CHANGES },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as SyncResponse).changes;
}

// Starts with the first installation: the web server gets a fresh database on every run and this file runs first.
test('parent prepares a book, the child reads, gets help, annotates and answers a local quiz', async ({ page, context, browser }) => {
  const pageErrors = trackPageErrors(page);

  await test.step('first installation, then sign-in on a fresh session', async () => {
    await page.goto('/');
    await page.waitForURL(/\/installation$/);
    await completeSetup(page);
    await expect(page.getByRole('heading', { name: 'Pas encore de profil' })).toBeVisible();

    await context.clearCookies();
    await page.reload();
    await page.waitForURL(/\/connexion$/);
    await login(page);
  });

  await test.step('parent area: PIN, child profile, PDF import', async () => {
    await ensureChild(page, CHILD);
    const pdf = await makeTextPdf(browser);
    await importDocument(page, BOOK, [{ name: 'le-volcan.pdf', mimeType: 'application/pdf', buffer: pdf }], 2);
    const row = page.locator('li', { hasText: BOOK });
    await expect(row).toContainText('Prêt', { timeout: 30_000 });
  });

  await test.step('the document and its text reach the server through sync', async () => {
    await expect
      .poll(async () => {
        const changes = await serverChanges(page);
        const doc = changes.documents.find((d) => d.title === BOOK);
        const firstPage = changes.pages.find((p) => p.documentId === doc?.id && p.pageIndex === 0);
        return firstPage?.blocks.map((b) => b.text).join(' ') ?? '';
      }, { timeout: 30_000, intervals: [1_000] })
      .toContain('La lave coulait lentement');
  });

  await test.step('the child opens the book on page 1', async () => {
    await openBooksAs(page, CHILD);
    await page.getByRole('button', { name: new RegExp(BOOK) }).first().click();
    await page.waitForURL(/\/lire\//);
    await expect(page.locator('.rp-page[data-page-index="0"]')).toContainText(PAGE_ONE.title);
    await expect(page.getByText('Page 1 / 2').first()).toBeVisible();
    await expect(page.locator('.rp-page[data-page-index="0"]')).toContainText('La lave coulait lentement sur la pente nord');
  });

  await test.step('📖 Définition of a glossary word, from the device', async () => {
    const word = page.locator('.rp-page[data-page-index="0"] .rp-w', { hasText: /^volcan$/ }).first();
    await word.tap();
    await expect(word).toHaveClass(/rp-w--sel/);
    const toolbar = page.getByRole('region', { name: 'Que veux-tu faire avec ce texte ?' })
      .or(page.locator('[aria-label="Que veux-tu faire avec ce texte ?"]')).first();
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole('button', { name: /Définition/ }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toContainText('Montagne d’où peuvent sortir de la lave');
    await sheet.getByRole('button', { name: 'Fermer' }).first().click();
    await expect(sheet).toBeHidden();
  });

  await test.step('💡 Explique: glossary first, then the help service', async () => {
    await page.getByRole('button', { name: /Explique/ }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toContainText('Montagne d’où peuvent sortir de la lave');
    const aiResponse = page.waitForResponse((r) => r.url().includes('/api/ai/explain_text') && r.request().method() === 'POST');
    await sheet.getByRole('button', { name: /Je ne comprends pas encore/ }).click();
    const response = await aiResponse;
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('ok');
    await expect(sheet.getByRole('button', { name: /Je ne comprends pas encore/ })).toBeHidden();
    await expect(sheet.getByText('Je réfléchis pour t’aider…')).toBeHidden();
    await sheet.getByRole('button', { name: 'Fermer' }).first().click();
    await expect(sheet).toBeHidden();
    await page.getByRole('button', { name: 'Fermer' }).first().click();
  });

  await test.step('✏️ annotation mode: a pen stroke is saved and survives a reload', async () => {
    await page.getByRole('radio', { name: /Annotation/ }).click();
    const pageBox = await page.locator('.rp-page[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    const paragraph = await page.locator('.rp-page[data-page-index="0"] .rp-block[data-block-index="2"]').boundingBox();
    expect(paragraph).not.toBeNull();
    await penStroke(page, { x: paragraph!.x + 40, y: paragraph!.y + paragraph!.height / 2 }, 220);
    const strokes = page.locator('.ink-layer[data-view="text"] path[data-ink-id]');
    await expect(strokes).toHaveCount(1);

    const saved = await readLocalTable<InkAnnotation>(page, 'annotations');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ type: 'ink', space: { kind: 'text', pageIndex: 0 } });

    await page.reload();
    await expect(page.locator('.rp-page[data-page-index="0"]')).toContainText(PAGE_ONE.title);
    await expect(page.locator('.ink-layer[data-view="text"] path[data-ink-id]')).toHaveCount(1);

    // With read-aloud open, the pencil toolbar stays above the bottom dock.
    await page.getByRole('radio', { name: /Annotation/ }).click();
    await page.getByRole('button', { name: 'Écouter le texte' }).click();
    const dock = page.locator('.rd-dock');
    const toolbar = page.locator('.pencil-toolbar');
    await expect(dock).toBeVisible();
    await expect(toolbar).toBeVisible();
    await expect.poll(async () => {
      const [d, t] = await Promise.all([dock.boundingBox(), toolbar.boundingBox()]);
      return d !== null && t !== null && t.y + t.height <= d.y;
    }).toBe(true);
    await page.getByRole('banner').getByRole('button', { name: 'Fermer la lecture à voix haute' }).click();
    await page.getByRole('radio', { name: /Lecture/ }).click();
  });

  await test.step('the stroke reaches the server through sync', async () => {
    await expect
      .poll(async () => (await serverChanges(page)).annotations.filter((a) => a.type === 'ink' && a.deletedAt === null).length, {
        timeout: 30_000,
        intervals: [1_000],
      })
      .toBe(1);
  });

  await test.step('🧠 local quiz when the help service cannot be reached, answered correctly', async () => {
    await page.route('**/api/ai/**', (route) => route.abort('internetdisconnected'));
    await page.goto('/exercices');
    await page.getByRole('button', { name: new RegExp(BOOK) }).first().click();
    await page.getByRole('link', { name: /Fais-moi des questions/ }).or(page.getByRole('button', { name: /Fais-moi des questions/ })).first().click();
    await expect(page.getByRole('heading', { name: /Fais-moi des questions/ })).toBeVisible();
    for (const type of ['Vrai ou faux', 'Réponse écrite', 'Relier', 'Remettre dans l’ordre']) {
      await page.getByRole('button', { name: type }).click();
    }
    await page.getByRole('radio', { name: '3', exact: true }).click();
    await page.getByRole('button', { name: /C’est parti/ }).click();
    await page.waitForURL(/\/exercices\/quiz\//);
    await expect(page.getByText('Questions préparées sans aide en ligne')).toBeVisible();

    const exerciseId = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() ?? '');
    const exercise = (await readLocalTable<Exercise>(page, 'exercises')).find((e) => e.id === exerciseId);
    expect(exercise?.origin).toBe('local');
    expect(exercise?.questions.length).toBe(3);
    const first = exercise!.questions[0]!;
    expect(first.type).toBe('qcm');
    if (first.type !== 'qcm') return;

    await expect(page.getByText('Question 1 sur 3')).toBeVisible();
    const choices = page.getByRole('group', { name: 'Choisis une réponse' });
    await choices.getByRole('button', { name: first.choices[first.correctIndex]!, exact: true }).click();
    await page.getByRole('button', { name: 'Valider' }).click();
    await expect(page.getByText('Exact !')).toBeVisible();
    await page.unroute('**/api/ai/**');
  });

  expect(pageErrors).toEqual([]);
});
