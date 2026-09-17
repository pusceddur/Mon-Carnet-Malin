// Downloads the French tessdata_best model (fra.traineddata) used by server OCR when OCR_SERVER_MODEL=best.
// Target: TESSDATA_BEST_DIR, else <DATA_DIR or ./data>/tessdata_best (same default as the server).
// The download is verified against the size (and git blob SHA-1) published by the GitHub API before being kept.
// Usage: node server/scripts/fetch-tessdata-best.mjs [--force]
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'tesseract-ocr/tessdata_best';
export const BRANCH = 'main';
export const MODEL_FILE = 'fra.traineddata';
/** A real model is several MB; anything smaller is an error page or a pointer file. */
export const MIN_MODEL_BYTES = 1_000_000;
export const DOWNLOAD_URL = `https://raw.githubusercontent.com/${REPOSITORY}/${BRANCH}/${MODEL_FILE}`;
export const METADATA_URL = `https://api.github.com/repos/${REPOSITORY}/contents/${MODEL_FILE}?ref=${BRANCH}`;
const USER_AGENT = 'MonCarnetMalin-setup/1.0';

/** SHA-1 of a git blob ("blob <size>\0<content>"), as returned in the `sha` field of the GitHub contents API. */
export function gitBlobSha1(bytes) {
  const hash = createHash('sha1');
  hash.update(`blob ${bytes.length}\0`);
  hash.update(bytes);
  return hash.digest('hex');
}

export function targetDirectory(env = process.env, cwd = process.cwd()) {
  const explicit = env.TESSDATA_BEST_DIR?.trim();
  if (explicit) return resolve(cwd, explicit);
  return join(resolve(cwd, env.DATA_DIR?.trim() || 'data'), 'tessdata_best');
}

/** Expected { size, sha } from the GitHub API, or null when the API cannot be reached. */
export async function fetchExpected(fetchImpl = fetch) {
  try {
    const res = await fetchImpl(METADATA_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const json = await res.json();
    if (typeof json?.size !== 'number' || json.size < MIN_MODEL_BYTES) return null;
    return { size: json.size, sha: typeof json.sha === 'string' ? json.sha : null };
  } catch {
    return null;
  }
}

/** Checks downloaded bytes against the expected metadata. Returns null when valid, else a reason. */
export function verifyModel(bytes, expected) {
  if (!expected || typeof expected.size !== 'number') return 'expected size unknown';
  if (bytes.length !== expected.size) return `size mismatch (expected ${expected.size} bytes, got ${bytes.length})`;
  if (bytes.length < MIN_MODEL_BYTES) return `file too small (${bytes.length} bytes)`;
  if (expected.sha && gitBlobSha1(bytes) !== expected.sha) return 'checksum mismatch';
  return null;
}

/**
 * @param {{ env?: Record<string, string | undefined>, cwd?: string, fetchImpl?: typeof fetch, force?: boolean, log?: (line: string) => void }} [options]
 * @returns {Promise<{ status: 'present' | 'downloaded', path: string, size: number }>}
 */
export async function fetchTessdataBest(options = {}) {
  const { env = process.env, cwd = process.cwd(), fetchImpl = fetch, force = false, log = () => undefined } = options;
  const dir = targetDirectory(env, cwd);
  const target = join(dir, MODEL_FILE);
  const expectedFromApi = await fetchExpected(fetchImpl);

  if (!force && existsSync(target)) {
    const current = await readFile(target);
    const problem = expectedFromApi ? verifyModel(current, expectedFromApi) : current.length < MIN_MODEL_BYTES ? 'file too small' : null;
    if (!problem) {
      log(`Model already present: ${target} (${current.length} bytes)`);
      return { status: 'present', path: target, size: current.length };
    }
    log(`Existing model rejected (${problem}), downloading again.`);
  }

  log(`Downloading ${DOWNLOAD_URL}`);
  const res = await fetchImpl(DOWNLOAD_URL, { headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity' } });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());

  let expected = expectedFromApi;
  if (!expected) {
    const encoding = res.headers.get('content-encoding');
    const length = Number(res.headers.get('content-length') ?? Number.NaN);
    if ((!encoding || encoding === 'identity') && Number.isFinite(length)) expected = { size: length, sha: null };
  }
  const problem = verifyModel(bytes, expected);
  if (problem) throw new Error(`Downloaded model rejected: ${problem}`);

  await mkdir(dir, { recursive: true });
  const partial = `${target}.part`;
  await writeFile(partial, bytes);
  const written = await stat(partial);
  if (written.size !== bytes.length) {
    await rm(partial, { force: true });
    throw new Error('Write verification failed');
  }
  await rename(partial, target);
  log(`Model saved: ${target} (${bytes.length} bytes). Set OCR_SERVER_MODEL=best to use it.`);
  return { status: 'downloaded', path: target, size: bytes.length };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  fetchTessdataBest({ force: process.argv.includes('--force'), log: (line) => process.stdout.write(`${line}\n`) }).catch((error) => {
    process.stderr.write(`fetch-tessdata-best: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
