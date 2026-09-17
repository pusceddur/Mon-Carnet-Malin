// Upload storage on disk (§15.6): server-generated names under <dataDir>/uploads, magic-byte allowlist.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export type UploadMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

export const DOCUMENT_FILE_MIMES: ReadonlySet<UploadMime> = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']);
export const PAGE_IMAGE_MIMES: ReadonlySet<UploadMime> = new Set(['image/jpeg', 'image/png', 'image/webp']);

const EXTENSIONS: Record<UploadMime, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/** Content type from the first bytes of a file, or null when not in the allowlist. */
export function detectMime(head: Uint8Array): UploadMime | null {
  const b = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' && HEIC_BRANDS.has(b.subarray(8, 12).toString('latin1'))) return 'image/heic';
  return null;
}

const APP1 = 0xe1;
const SOS = 0xda;
const EXIF_ID = Buffer.from('Exif', 'latin1');
const XMP_ID = Buffer.from('http://ns.adobe.com/xap/1.0/', 'latin1');

/**
 * Removes EXIF and XMP (APP1) segments from a JPEG, e.g. GPS position of a photo; image data is copied untouched.
 * Returns null when nothing was removed or the structure is not understood (the file is then kept as is).
 */
export function stripJpegMetadata(input: Buffer): Buffer | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
  const kept: Buffer[] = [input.subarray(0, 2)];
  let removed = false;
  let pos = 2;
  while (pos < input.length) {
    if (input[pos] !== 0xff) return null;
    let markerPos = pos;
    while (markerPos < input.length && input[markerPos] === 0xff) markerPos++; // fill bytes
    const marker = input[markerPos];
    if (marker === undefined) return null;
    // Standalone markers (TEM, RSTn) have no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(input.subarray(pos, markerPos + 1));
      pos = markerPos + 1;
      continue;
    }
    if (marker === 0xd9) {
      kept.push(input.subarray(pos));
      break;
    }
    if (markerPos + 2 >= input.length) return null;
    const length = input.readUInt16BE(markerPos + 1);
    const end = markerPos + 1 + length;
    if (length < 2 || end > input.length) return null;
    if (marker === SOS) {
      kept.push(input.subarray(pos));
      break;
    }
    const payload = input.subarray(markerPos + 3, end);
    const isMetadata = marker === APP1 && (payload.subarray(0, EXIF_ID.length).equals(EXIF_ID) || payload.subarray(0, XMP_ID.length).equals(XMP_ID));
    if (isMetadata) removed = true;
    else kept.push(input.subarray(pos, end));
    pos = end;
  }
  return removed ? Buffer.concat(kept) : null;
}

/** Strips JPEG metadata in place; returns the new size, or null when the file was left unchanged. */
export async function stripJpegFile(path: string): Promise<number | null> {
  const stripped = stripJpegMetadata(await readFile(path));
  if (!stripped) return null;
  await writeFile(path, stripped);
  return stripped.length;
}

export async function readHead(path: string, bytes = 32): Promise<Uint8Array> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

/** Directory-safe form of an id: UUID-like ids as is, anything else hashed (ids come from clients through sync). */
export function safeSegment(id: string): string {
  return /^[A-Za-z0-9-]{1,36}$/.test(id) ? id : createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 32);
}

/** Relative storage path (forward slashes) for a new file. */
export function newStoragePath(parentId: string, documentId: string, prefix: string, mime: UploadMime): string {
  return [safeSegment(parentId), safeSegment(documentId), `${prefix}-${randomUUID()}.${EXTENSIONS[mime]}`].join('/');
}

/** Absolute path of a stored relative path, refusing anything outside the uploads root. */
export function resolveStoragePath(root: string, storagePath: string): string {
  const absolute = resolve(root, ...storagePath.split('/'));
  const rel = relative(root, absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error('storage_path_outside_root');
  return absolute;
}

export function tempUploadDir(root: string): string {
  return join(root, 'tmp');
}

export async function moveIntoStorage(root: string, tempPath: string, storagePath: string): Promise<string> {
  const target = resolveStoragePath(root, storagePath);
  await mkdir(dirname(target), { recursive: true });
  await rename(tempPath, target);
  return target;
}

export async function removeQuietly(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await rm(path, { force: true });
  } catch {
    // best effort
  }
}

/** Removes a stored file and its now-empty parent directories up to the root (best effort). */
export async function removeStored(root: string, storagePath: string): Promise<void> {
  let target: string;
  try {
    target = resolveStoragePath(root, storagePath);
  } catch {
    return;
  }
  await removeQuietly(target);
  let dir = dirname(target);
  while (dir.startsWith(root + sep) && dir !== root) {
    try {
      await rmdir(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

export async function fileSize(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

/** Name safe for storage and Content-Disposition: no control chars or path separators, at most 255 chars. */
export function sanitizeFileName(name: string | undefined, fallback: string): string {
  const cleaned = (name ?? '')
    .normalize('NFC')
    .replace(/[\x00-\x1f\x7f"\\/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? fallback : cleaned;
}

/** RFC 6266 attachment header with an ASCII fallback and a UTF-8 filename*. */
export function attachmentDisposition(name: string): string {
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/[%;]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
