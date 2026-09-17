import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Text of the OCR fixture page (French, with accents, ligature, guillemets and apostrophes). */
export const FRENCH_PAGE = {
  title: 'La forêt enchantée',
  paragraphs: [
    'Élodie marche lentement dans la forêt. Les feuilles des arbres brillent sous le soleil d’été, et un écureuil curieux la regarde depuis une branche.',
    'Près du ruisseau, un garçon pêche des truites. « Où vas-tu ? » demande-t-il. Élodie répond qu’elle cherche la clé du vieux château.',
    'Son cœur bat très fort : à côté de la fenêtre, elle aperçoit déjà la tour où dort un hibou naïf.',
  ],
} as const;

export function frenchPageText(): string {
  return [FRENCH_PAGE.title, ...FRENCH_PAGE.paragraphs].join('\n\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function frenchPageHtml(): string {
  const paragraphs = FRENCH_PAGE.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<style>
  html, body { margin: 0; background: #ffffff; color: #1a1a1a; }
  main { width: 860px; padding: 56px 64px; font-family: Georgia, 'Times New Roman', serif; font-size: 21px; line-height: 1.55; }
  h1 { font-size: 34px; margin: 0 0 28px; font-weight: bold; }
  p { margin: 0 0 18px; text-align: left; }
</style></head>
<body><main><h1>${escapeHtml(FRENCH_PAGE.title)}</h1>
${paragraphs}
</main></body></html>`;
}

/** Renders the fixture page to PNG with the locally installed Chrome (Playwright). */
export async function renderFrenchPagePng(outputPath: string): Promise<Buffer> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 988, height: 600 }, deviceScaleFactor: 2 });
    await page.setContent(frenchPageHtml(), { waitUntil: 'load' });
    const png = await page.locator('main').screenshot({ type: 'png' });
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, png);
    return png;
  } finally {
    await browser.close();
  }
}

/** Levenshtein distance on Unicode code points. */
export function editDistance(a: string, b: string): number {
  const s = Array.from(a);
  const t = Array.from(b);
  let previous = Array.from({ length: t.length + 1 }, (_v, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
    }
    previous = current;
  }
  return previous[t.length] ?? 0;
}

/** Whitespace collapsed and apostrophe variants unified (typography, not recognition, errors). */
export function normalizeForCer(s: string): string {
  return s.normalize('NFC').replace(/['‘’]/g, '’').replace(/\s+/g, ' ').trim();
}

export function characterErrorRate(expected: string, actual: string): number {
  const e = normalizeForCer(expected);
  return editDistance(e, normalizeForCer(actual)) / Math.max(1, Array.from(e).length);
}
