import { expect, type Page } from '@playwright/test';
import { E2E_SETUP_TOKEN, PARENT } from './env';

/** Reaches a signed-in parent session: first installation when the server has no account, sign-in otherwise. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForURL(/\/(installation|connexion|enfant|accueil)$/);
  const path = new URL(page.url()).pathname;
  if (path === '/installation') {
    await completeSetup(page);
  } else if (path === '/connexion') {
    await login(page);
  }
}

export async function completeSetup(page: Page): Promise<void> {
  await page.getByLabel('Code d’installation').fill(E2E_SETUP_TOKEN);
  await page.getByLabel('Votre prénom').fill(PARENT.displayName);
  await page.getByLabel('E-mail').fill(PARENT.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PARENT.password);
  await page.getByLabel('Confirmer le mot de passe').fill(PARENT.password);
  await page.getByLabel('Code des réglages', { exact: true }).fill(PARENT.pin);
  await page.getByLabel('Confirmer le code des réglages').fill(PARENT.pin);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await page.waitForURL(/\/enfant$/);
}

export async function login(page: Page): Promise<void> {
  await page.getByLabel('E-mail').fill(PARENT.email);
  await page.getByLabel('Mot de passe').fill(PARENT.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/(enfant|accueil)$/);
}

/** Opens a parent-area page, typing the parent PIN on the gate when it is shown. */
export async function openParentArea(page: Page, subPath: string): Promise<void> {
  await page.goto(`/parent/${subPath}`);
  const header = page.getByRole('button', { name: 'Verrouiller' });
  const gate = page.getByRole('heading', { name: /Réglages/ });
  await expect(header.or(gate).first()).toBeVisible();
  if (!(await header.isVisible())) {
    await page.keyboard.type(PARENT.pin);
    await page.keyboard.press('Enter');
    await expect(header).toBeVisible();
  }
}

/** Creates the child profile unless it already exists (parent area must be unlocked). */
export async function ensureChild(page: Page, nickname: string): Promise<void> {
  await openParentArea(page, 'enfants');
  await expect(page.getByRole('heading', { name: 'Enfants' })).toBeVisible();
  const existing = page.locator('.parent-list__title', { hasText: nickname });
  if ((await existing.count()) > 0) return;
  await page.getByRole('button', { name: 'Ajouter un enfant' }).first().click();
  await page.getByLabel('Surnom du lecteur').fill(nickname);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.locator('.parent-list__title', { hasText: nickname })).toBeVisible();
}

export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** Imports files as one document from /parent/importer and returns to the document list. */
export async function importDocument(page: Page, title: string, files: UploadFile[], totalPages: number): Promise<void> {
  await openParentArea(page, 'importer');
  await page.locator('input[type=file][multiple]').setInputFiles(files);
  await expect(page.getByText(`Total : ${totalPages} page(s)`)).toBeVisible();
  await page.getByLabel('Titre').fill(title);
  await page.getByRole('button', { name: 'Importer', exact: true }).click();
  await page.waitForURL(/\/parent\/documents$/);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

/** Leaves the parent area as the given child and opens « Mes livres ». */
export async function openBooksAs(page: Page, nickname: string): Promise<void> {
  await page.goto('/enfant');
  await page.getByRole('button', { name: `C’est moi, ${nickname}` }).click();
  await page.waitForURL(/\/accueil$/);
  await expect(page.getByRole('heading', { name: new RegExp(`Bonjour ${nickname}`) })).toBeVisible();
  await page.getByRole('button', { name: /Mes livres/ }).click();
  await page.waitForURL(/\/livres$/);
}

/** Draws a stroke with trusted pen pointer events (Chrome DevTools Protocol, pointerType "pen"). */
export async function penStroke(page: Page, from: { x: number; y: number }, length: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const pen = { pointerType: 'pen' as const, force: 0.5 };
  try {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', ...pen });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1, ...pen });
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const x = from.x + (length * i) / steps;
      const y = from.y + Math.sin(i / 3) * 8;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, ...pen });
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x + length, y: from.y, button: 'left', buttons: 0, clickCount: 1, ...pen });
  } finally {
    await cdp.detach();
  }
}

/** Reads every row of a table of the app's IndexedDB database. */
export async function readLocalTable<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(async (storeName) => {
    const request = indexedDB.open('aide');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const all = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      return await new Promise<unknown[]>((resolve, reject) => {
        all.onsuccess = () => resolve(all.result);
        all.onerror = () => reject(all.error);
      });
    } finally {
      database.close();
    }
  }, table) as Promise<T[]>;
}

/** Collects uncaught page errors so a test can assert the app never crashed. */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}
