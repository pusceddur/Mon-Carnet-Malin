// Copies the self-hosted OCR / PDF assets into public/ and generates the French word list (contract §15.6).
//   public/ocr/      tesseract.js worker, every tesseract-core variant (.js, .wasm, .wasm.js), fra.traineddata.gz
//   public/pdfjs/    wasm decoders, standard fonts, cmaps, ICC profiles
//   public/data/     mots-fr.txt: unique normalized French words, sorted (UTF-16 code unit order), one per line
//   public/offline-assets.json: URLs to download for offline use (« Préparer le mode hors ligne »)
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(clientDir, 'public');
const requireFromClient = createRequire(join(clientDir, 'package.json'));

function packageDir(name, require = requireFromClient) {
  return dirname(require.resolve(`${name}/package.json`));
}

function fail(message) {
  process.stderr.write(`copy-assets: ${message}\n`);
  process.exit(1);
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/** Copies when the destination is missing or differs in size. Returns the size in bytes. */
function copyFile(src, dest) {
  if (!existsSync(src)) fail(`missing file ${src}`);
  const srcSize = statSync(src).size;
  if (!existsSync(dest) || statSync(dest).size !== srcSize) {
    ensureDir(dirname(dest));
    copyFileSync(src, dest);
  }
  return srcSize;
}

function listFiles(dir) {
  if (!existsSync(dir)) fail(`missing directory ${dir}`);
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

const isLicense = (name) => /^LICENSE/i.test(name);

/** @type {{ url: string; bytes: number; group: 'ocr' | 'pdfjs' | 'data' }[]} */
const offline = [];

// ---------- OCR (tesseract.js 7) ----------
const tesseractDir = packageDir('tesseract.js');
const requireFromTesseract = createRequire(join(tesseractDir, 'package.json'));
const coreDir = packageDir('tesseract.js-core', requireFromTesseract);
const fraDir = packageDir('@tesseract.js-data/fra');
const ocrOut = join(publicDir, 'ocr');
ensureDir(ocrOut);

offline.push({ url: '/ocr/worker.min.js', bytes: copyFile(join(tesseractDir, 'dist', 'worker.min.js'), join(ocrOut, 'worker.min.js')), group: 'ocr' });

const coreFiles = listFiles(coreDir).filter((name) => /^tesseract-core.*\.(js|wasm)$/.test(name) && name !== 'index.js');
if (coreFiles.length === 0) fail(`no tesseract-core files in ${coreDir}`);
for (const name of coreFiles) {
  const bytes = copyFile(join(coreDir, name), join(ocrOut, name));
  // The worker always loads « <variant>.wasm.js » and, with OEM 1 (LSTM only), one of the three -lstm variants.
  if (/-lstm\.wasm\.js$/.test(name)) offline.push({ url: `/ocr/${name}`, bytes, group: 'ocr' });
}

const trainedData = join(fraDir, '4.0.0_best_int', 'fra.traineddata.gz');
offline.push({ url: '/ocr/fra.traineddata.gz', bytes: copyFile(trainedData, join(ocrOut, 'fra.traineddata.gz')), group: 'ocr' });

// ---------- pdf.js ----------
const pdfjsDir = packageDir('pdfjs-dist');
const pdfjsOut = join(publicDir, 'pdfjs');
for (const sub of ['wasm', 'standard_fonts', 'cmaps', 'iccs']) {
  for (const name of listFiles(join(pdfjsDir, sub))) {
    // Scripting is disabled (enableScripting: false): the JS sandbox engine is never loaded.
    if (sub === 'wasm' && name.startsWith('quickjs')) continue;
    const bytes = copyFile(join(pdfjsDir, sub, name), join(pdfjsOut, sub, name));
    if (!isLicense(name)) offline.push({ url: `/pdfjs/${sub}/${name}`, bytes, group: 'pdfjs' });
  }
}

// ---------- French word list ----------
// Same steps as normalizeForMatch (shared/src/text/normalize.ts) for single words.
function normalizeWord(word) {
  return word
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const wordsDir = packageDir('an-array-of-french-words');
const rawWords = JSON.parse(readFileSync(join(wordsDir, 'index.json'), 'utf8'));
if (!Array.isArray(rawWords) || rawWords.length < 1000) fail('unexpected format of an-array-of-french-words/index.json');
const unique = new Set();
for (const word of rawWords) {
  if (typeof word !== 'string') continue;
  const normalized = normalizeWord(word);
  // Single words only: compounds (« arc-en-ciel ») are recognized part by part in src/ocr/quality.ts.
  if (normalized.length > 0 && normalized.length <= 40 && !normalized.includes(' ')) unique.add(normalized);
}
const sortedWords = Array.from(unique).sort();
const dataOut = join(publicDir, 'data');
ensureDir(dataOut);
const wordsText = `${sortedWords.join('\n')}\n`;
writeFileSync(join(dataOut, 'mots-fr.txt'), wordsText, 'utf8');
offline.push({ url: '/data/mots-fr.txt', bytes: Buffer.byteLength(wordsText, 'utf8'), group: 'data' });

// ---------- offline manifest ----------
const versionOf = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
const manifest = {
  version: [
    `tesseract.js@${versionOf(tesseractDir)}`,
    `tesseract.js-core@${versionOf(coreDir)}`,
    `pdfjs-dist@${versionOf(pdfjsDir)}`,
    `mots-fr@${sortedWords.length}`,
  ].join('+'),
  totalBytes: offline.reduce((sum, file) => sum + file.bytes, 0),
  files: offline,
};
writeFileSync(join(publicDir, 'offline-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

process.stdout.write(
  `copy-assets: ${coreFiles.length} tesseract-core files, ${sortedWords.length} words, ` +
    `${offline.length} offline assets (${(manifest.totalBytes / 1048576).toFixed(1)} MiB) -> ${basename(publicDir)}/\n`,
);
