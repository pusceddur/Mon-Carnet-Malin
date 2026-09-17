import type { Browser } from '@playwright/test';

/** French school text used by the PDF and image fixtures (glossary words: volcan, lave). */
export const PAGE_ONE = {
  title: 'Le réveil du volcan',
  paragraphs: [
    'Au pied de la montagne, le village de Saint-Clair dormait encore. Léo ouvrit la fenêtre et regarda le sommet.',
    'Depuis trois jours, le volcan fumait sans bruit. Les habitants avaient pris l’habitude de cette petite colonne grise.',
    'Ce matin-là, une lueur rouge apparut. La lave coulait lentement sur la pente nord, loin des maisons.',
    'Le maire réunit les familles sur la place. Il expliqua que les scientifiques surveillaient la montagne jour et nuit.',
    'Léo prit son carnet et dessina la montagne. Il voulait tout noter pour raconter cette journée à sa grand-mère.',
  ],
} as const;

export const PAGE_TWO = {
  title: 'Une journée à l’école',
  paragraphs: [
    'À l’école, la maîtresse parla des volcans. Elle montra une carte avec les grandes chaînes de montagnes.',
    'Les élèves posèrent beaucoup de questions. Pourquoi la terre est-elle si chaude à l’intérieur ?',
  ],
} as const;

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function pageHtml(page: { title: string; paragraphs: readonly string[] }, breakAfter: boolean): string {
  const paragraphs = page.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
  return `<section style="${breakAfter ? 'page-break-after: always;' : ''}"><h1>${escapeHtml(page.title)}</h1>${paragraphs}</section>`;
}

const STYLE = `
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 20px; line-height: 1.5; color: #111; margin: 0; background: #fff; }
  h1 { font-size: 34px; margin: 0 0 28px; }
  p { margin: 0 0 22px; }
`;

/** Two-page A4 PDF with a real text layer, rendered by Chrome. */
export async function makeTextPdf(browser: Browser): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${STYLE}</style></head>
      <body>${pageHtml(PAGE_ONE, true)}${pageHtml(PAGE_TWO, false)}</body></html>`);
    return await page.pdf({ format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' }, printBackground: true });
  } finally {
    await page.close();
  }
}

/** PNG image of a printed page (no text layer: the app must run OCR on it). */
export async function makeTextPng(browser: Browser, content: { title: string; paragraphs: readonly string[] } = PAGE_ONE): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 1240, height: 1100 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${STYLE}
      body { padding: 80px 90px; font-size: 30px; } h1 { font-size: 44px; }</style></head>
      <body>${pageHtml(content, false)}</body></html>`);
    return await page.screenshot({ type: 'png', fullPage: true });
  } finally {
    await page.close();
  }
}
