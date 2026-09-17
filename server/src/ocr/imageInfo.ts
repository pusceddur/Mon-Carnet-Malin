export type OcrImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageInfo {
  mime: OcrImageMime;
  /** Null when the header does not expose the size (the image is still accepted). */
  width: number | null;
  height: number | null;
}

/** Decoded pixel budget: the OCR engine runs in WebAssembly with limited memory. */
export const OCR_IMAGE_MAX_SIDE_PX = 8_000;
export const OCR_IMAGE_MAX_PIXELS = 36_000_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buf: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function ascii(buf: Uint8Array, offset: number, length: number): string {
  if (buf.length < offset + length) return '';
  return String.fromCharCode(...buf.subarray(offset, offset + length));
}

function u16be(buf: Uint8Array, o: number): number {
  return ((buf[o] ?? 0) << 8) | (buf[o + 1] ?? 0);
}

function u16le(buf: Uint8Array, o: number): number {
  return (buf[o] ?? 0) | ((buf[o + 1] ?? 0) << 8);
}

function u24le(buf: Uint8Array, o: number): number {
  return (buf[o] ?? 0) | ((buf[o + 1] ?? 0) << 8) | ((buf[o + 2] ?? 0) << 16);
}

function u32be(buf: Uint8Array, o: number): number {
  return (((buf[o] ?? 0) << 24) >>> 0) + (((buf[o + 1] ?? 0) << 16) | ((buf[o + 2] ?? 0) << 8) | (buf[o + 3] ?? 0));
}

function u32le(buf: Uint8Array, o: number): number {
  return ((buf[o] ?? 0) | ((buf[o + 1] ?? 0) << 8) | ((buf[o + 2] ?? 0) << 16)) + (((buf[o + 3] ?? 0) << 24) >>> 0);
}

function pngSize(buf: Uint8Array): { width: number | null; height: number | null } {
  if (ascii(buf, 12, 4) !== 'IHDR' || buf.length < 24) return { width: null, height: null };
  return { width: u32be(buf, 16), height: u32be(buf, 20) };
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(buf: Uint8Array): { width: number | null; height: number | null } {
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) return { width: null, height: null };
    const marker = buf[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const length = u16be(buf, i + 2);
    if (length < 2) return { width: null, height: null };
    if (JPEG_SOF.has(marker)) {
      if (i + 8 >= buf.length) return { width: null, height: null };
      return { height: u16be(buf, i + 5), width: u16be(buf, i + 7) };
    }
    i += 2 + length;
  }
  return { width: null, height: null };
}

function webpSize(buf: Uint8Array): { width: number | null; height: number | null } {
  const chunk = ascii(buf, 12, 4);
  if (chunk === 'VP8 ' && buf.length >= 30 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
    return { width: u16le(buf, 26) & 0x3fff, height: u16le(buf, 28) & 0x3fff };
  }
  if (chunk === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
    const bits = u32le(buf, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && buf.length >= 30) {
    return { width: u24le(buf, 24) + 1, height: u24le(buf, 27) + 1 };
  }
  return { width: null, height: null };
}

/** Identifies JPEG / PNG / WebP from magic bytes (never from the declared MIME type or file name). */
export function sniffImage(buf: Uint8Array): ImageInfo | null {
  if (startsWith(buf, PNG_SIGNATURE)) return { mime: 'image/png', ...pngSize(buf) };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ...jpegSize(buf) };
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return { mime: 'image/webp', ...webpSize(buf) };
  return null;
}

/** True when the declared dimensions exceed what the OCR engine may decode safely. */
export function exceedsPixelBudget(info: ImageInfo): boolean {
  if (info.width === null || info.height === null) return false;
  if (info.width === 0 || info.height === 0) return true;
  return info.width > OCR_IMAGE_MAX_SIDE_PX || info.height > OCR_IMAGE_MAX_SIDE_PX || info.width * info.height > OCR_IMAGE_MAX_PIXELS;
}
