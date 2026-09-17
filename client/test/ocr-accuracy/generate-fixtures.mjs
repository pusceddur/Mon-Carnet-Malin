// Renders French text fixtures with Chrome (Playwright) for the OCR accuracy test: clean page, skewed photo on a table,
// dark and faded pages, several fonts, columns, title, numbers, accents, a hard photo, small print, upside down, and a
// gray scanned page on white (as inside a PDF).
// Usage: node test/ocr-accuracy/generate-fixtures.mjs [--force]   (existing fixtures are kept unless --force)
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeGrayPng } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures');
const force = process.argv.includes('--force');

const P1 =
  'Les plantes vertes fabriquent leur nourriture grâce à la lumière du soleil. Ce phénomène s’appelle la photosynthèse. ' +
  'Les feuilles captent l’énergie lumineuse et absorbent le gaz carbonique de l’air.';
const P2 =
  'Au printemps, les élèves de la classe ont planté des graines dans le jardin de l’école. Chaque matin, ils arrosent ' +
  'les jeunes pousses et notent leurs observations dans un cahier.';
const P3 =
  'Le fleuve traverse la ville du nord au sud. Autrefois, les bateliers transportaient du bois, du blé et du vin ' +
  'jusqu’au port, où les marchands attendaient leur arrivée.';
const NUMBERS =
  'En 1789, la ville comptait 2 300 habitants. Le 14 juillet, 25 % des familles étaient au marché. ' +
  'Le trajet mesurait 3,5 km et durait 45 minutes ; le billet coûtait 12 euros.';
const ACCENTS =
  'À côté de la forêt, où l’été est très chaud, un garçon naïf lit près de l’hôpital. Noël approche : ' +
  'le cœur des élèves bat fort, même en août, et ça leur plaît beaucoup.';

/** @typedef {{ name: string; truth: string; html: string; scene: 'page' | 'photo'; noise?: number; blur?: number; light?: 'dark' | 'faded'; rotate?: number; paper?: string; ink?: string; fontSize?: number; whiteBelow?: number }} Fixture */

const para = (text, style = '') => `<p style="${style}">${text}</p>`;

/** @type {Fixture[]} */
const FIXTURES = [
  { name: 'normal', truth: [P1, P2].join('\n'), scene: 'page', html: para(P1) + para(P2) },
  { name: 'inclinee-4deg', truth: [P1, P2].join('\n'), scene: 'photo', noise: 6, blur: 0.4, html: para(P1) + para(P2) },
  {
    name: 'sombre',
    truth: [P2, P3].join('\n'),
    scene: 'page',
    light: 'dark',
    noise: 10,
    html: para(P2) + para(P3),
  },
  { name: 'claire', truth: [P1, P3].join('\n'), scene: 'page', light: 'faded', html: para(P1) + para(P3) },
  { name: 'police-sans', truth: P2, scene: 'page', html: para(P2, 'font-family: Verdana, Arial, sans-serif; font-size: 20px') },
  { name: 'police-mono', truth: P3, scene: 'page', html: para(P3, 'font-family: "Courier New", monospace; font-size: 20px') },
  { name: 'police-grande', truth: P1, scene: 'page', html: para(P1, 'font-family: Georgia, serif; font-size: 30px; line-height: 1.5') },
  {
    name: 'deux-colonnes',
    truth: [P1, P3].join('\n'),
    scene: 'page',
    html: `<div style="columns: 2; column-gap: 48px">${para(P1, 'margin-top: 0')}${para(P3)}</div>`,
  },
  {
    name: 'titre',
    truth: ['Chapitre 3 : Les saisons', P2].join('\n'),
    scene: 'page',
    html: `<h1 style="font-size: 34px; margin: 0 0 16px">Chapitre 3 : Les saisons</h1>${para(P2)}`,
  },
  { name: 'nombres', truth: NUMBERS, scene: 'page', html: para(NUMBERS) },
  { name: 'accents', truth: ACCENTS, scene: 'page', html: para(ACCENTS) },
  {
    name: 'photo-difficile',
    truth: [P3, NUMBERS].join('\n'),
    scene: 'photo',
    rotate: -7,
    noise: 18,
    blur: 1,
    fontSize: 19,
    paper: 'radial-gradient(circle at 15% 10%, #ffffff, #c4c4c4 65%, #8e8e8e)',
    ink: '#2e2e2e',
    html: para(P3) + para(NUMBERS),
  },
  { name: 'petite-police', truth: [P1, ACCENTS].join('\n'), scene: 'page', fontSize: 13, noise: 5, blur: 0.5, html: para(P1) + para(ACCENTS) },
  { name: 'a-l-envers', truth: P2, scene: 'page', rotate: 180, noise: 4, html: para(P2) },
  {
    name: 'scan-gris',
    truth: [P3, ACCENTS].join('\n'),
    scene: 'page',
    paper: '#8a8a8a',
    ink: '#161616',
    noise: 8,
    whiteBelow: 320,
    html: para(P3) + para(ACCENTS),
  },
  {
    name: 'titre-colonnes',
    truth: ['Le cycle de l’eau', P1, P2].join('\n'),
    scene: 'page',
    html: `<h1 style="font-size: 32px; margin: 0 0 24px">Le cycle de l’eau</h1><div style="columns: 2; column-gap: 56px">${para(P1, 'margin-top: 0')}${para(P2)}</div>`,
  },
];

function pageHtml(fixture) {
  const photo = fixture.scene === 'photo';
  const dark = fixture.light === 'dark';
  const faded = fixture.light === 'faded';
  const paper = fixture.paper ?? (dark ? 'linear-gradient(100deg, #5d5d5d, #8a8a8a 60%, #6f6f6f)' : '#fdfdfb');
  const ink = fixture.ink ?? (dark ? '#1c1c1c' : faded ? '#a9a9a9' : '#1a1a1a');
  const rotate = fixture.rotate ?? (photo ? 4 : 0);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: ${photo ? '#4a3b2e' : '#ffffff'}; }
    #scene { width: 860px; padding: ${photo ? '70px 60px' : `0 0 ${fixture.whiteBelow ?? 0}px`}; }
    #paper { box-sizing: border-box; width: ${photo ? '740px' : '860px'}; padding: 36px 44px; background: ${paper}; color: ${ink};
      font-family: Georgia, 'Times New Roman', serif; font-size: ${fixture.fontSize ?? 22}px; line-height: 1.45;
      ${rotate ? `transform: rotate(${rotate}deg);` : ''} ${photo ? 'box-shadow: 0 6px 24px rgba(0,0,0,0.5);' : ''} }
    p { margin: 0 0 18px; }
  </style></head><body><div id="scene"><div id="paper">${fixture.html}</div></div></body></html>`;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const todo = FIXTURES.filter((f) => force || !existsSync(join(outDir, `${f.name}.png`)) || !existsSync(join(outDir, `${f.name}.txt`)));
  if (todo.length === 0) {
    process.stdout.write('ocr fixtures: up to date\n');
    return;
  }
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 980, height: 800 } });
    const page = await context.newPage();
    for (const fixture of todo) {
      await page.setContent(pageHtml(fixture));
      await page.evaluate(() => document.fonts.ready);
      const png = await page.locator('#scene').screenshot({ type: 'png' });
      // Degrade in the page (canvas): optional blur, then seeded Gaussian sensor noise, then grayscale.
      const result = await page.evaluate(
        async ({ base64, noise, blur }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${base64}`;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (blur > 0) ctx.filter = `blur(${blur}px)`;
          ctx.drawImage(img, 0, 0);
          const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          // mulberry32: no visible pattern in the noise.
          let seed = 12345;
          const random = () => {
            seed = (seed + 0x6d2b79f5) >>> 0;
            let t = seed;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
          const gray = new Uint8Array(width * height);
          for (let i = 0; i < gray.length; i++) {
            const p = i * 4;
            let v = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
            if (noise > 0) {
              const g = Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
              v += g * noise;
            }
            gray[i] = Math.max(0, Math.min(255, Math.round(v)));
          }
          let binary = '';
          for (let i = 0; i < gray.length; i += 32768) binary += String.fromCharCode(...gray.subarray(i, i + 32768));
          return { width, height, base64: btoa(binary) };
        },
        { base64: png.toString('base64'), noise: fixture.noise ?? 0, blur: fixture.blur ?? 0 },
      );
      const gray = Buffer.from(result.base64, 'base64');
      writeFileSync(join(outDir, `${fixture.name}.png`), encodeGrayPng({ data: gray, width: result.width, height: result.height }));
      writeFileSync(join(outDir, `${fixture.name}.txt`), `${fixture.truth}\n`, 'utf8');
      process.stdout.write(`ocr fixture ${fixture.name}: ${result.width}x${result.height}\n`);
    }
  } finally {
    await browser.close();
  }
}

await main();
