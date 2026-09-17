// Image decoding / encoding with OffscreenCanvas (window or worker) or a DOM canvas (window only).
import { grayToRgba, type GrayImage, type RgbaImage } from './image';

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export class ImageDecodeError extends Error {
  constructor(message = 'image_decode_failed') {
    super(message);
    this.name = 'ImageDecodeError';
  }
}

export function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas === 'function';
}

function hasDocument(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function createCanvas(width: number, height: number): { canvas: AnyCanvas; ctx: Context2D } {
  if (hasOffscreenCanvas()) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx) return { canvas, ctx };
  }
  if (hasDocument()) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) return { canvas, ctx };
  }
  throw new ImageDecodeError('canvas_unavailable');
}

/** Frees the backing store right away (iPad Safari counts canvas memory until garbage collection). */
function releaseCanvas(canvas: AnyCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

async function loadWithImageElement(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    if (typeof img.decode === 'function') {
      await img.decode();
    } else {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new ImageDecodeError());
      });
    }
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

/** Decodes with EXIF orientation applied (createImageBitmap, else <img>, which follows EXIF in Safari). */
export async function decodeImage(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Unsupported format (HEIC outside Safari) or option: try the image element below.
    }
  }
  if (hasDocument() && typeof Image === 'function') {
    try {
      const img = await loadWithImageElement(blob);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
      }
    } catch {
      // Fall through.
    }
  }
  throw new ImageDecodeError();
}

/** True when this browser can decode the image (used for HEIC before import). */
export async function canDecodeImage(blob: Blob): Promise<boolean> {
  try {
    const decoded = await decodeImage(blob);
    decoded.close();
    return true;
  } catch {
    return false;
  }
}

/** Decodes and downsizes so that the long side is at most `maxSide`. */
export async function decodeToRgba(blob: Blob, maxSide: number, rotateQuarter: 0 | 90 | 180 | 270 = 0): Promise<RgbaImage> {
  const decoded = await decodeImage(blob);
  try {
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));
    const w = Math.max(1, Math.round(decoded.width * scale));
    const h = Math.max(1, Math.round(decoded.height * scale));
    const swap = rotateQuarter === 90 || rotateQuarter === 270;
    const { canvas, ctx } = createCanvas(swap ? h : w, swap ? w : h);
    try {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (rotateQuarter !== 0) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rotateQuarter * Math.PI) / 180);
        ctx.drawImage(decoded.source, -w / 2, -h / 2, w, h);
      } else {
        ctx.drawImage(decoded.source, 0, 0, w, h);
      }
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return { data: imageData.data, width: imageData.width, height: imageData.height };
    } finally {
      releaseCanvas(canvas);
    }
  } finally {
    decoded.close();
  }
}

async function canvasToBlob(canvas: AnyCanvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageDecodeError('encode_failed'))), type, quality);
  });
}

/** Grayscale → JPEG (no EXIF metadata is ever written by the canvas encoder). */
export async function encodeGrayJpeg(img: GrayImage, quality = 0.85): Promise<Blob> {
  const { canvas, ctx } = createCanvas(img.width, img.height);
  try {
    ctx.putImageData(new ImageData(grayToRgba(img), img.width, img.height), 0, 0);
    return await canvasToBlob(canvas, 'image/jpeg', quality);
  } finally {
    releaseCanvas(canvas);
  }
}

/** RGBA → JPEG (re-encoding strips EXIF / GPS before an upload). */
export async function encodeRgbaJpeg(img: RgbaImage, quality = 0.9): Promise<Blob> {
  const { canvas, ctx } = createCanvas(img.width, img.height);
  try {
    const copy = new Uint8ClampedArray(img.data.length);
    copy.set(img.data);
    ctx.putImageData(new ImageData(copy, img.width, img.height), 0, 0);
    return await canvasToBlob(canvas, 'image/jpeg', quality);
  } finally {
    releaseCanvas(canvas);
  }
}
