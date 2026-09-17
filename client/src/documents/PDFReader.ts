// PDF access with the pdfjs-dist legacy build (contract C18, §15.6): text extraction as layout lines and page rendering.
// pdf.js is imported lazily so that it stays out of the start-up bundle.
import type { LayoutLine } from '@aide/shared';
import type { DocumentInitParameters, TextItem } from 'pdfjs-dist/types/src/display/api';
import type { RgbaImage } from '../ocr/preprocess/image';

export const PDF_RENDER_MAX_SIDE = 2480;

/** Subset of a pdf.js TextItem used for layout reconstruction. */
export interface PdfTextItemLike {
  str: string;
  /** [a, b, c, d, e, f] text matrix in PDF user space. */
  transform: readonly number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

type Matrix = readonly [number, number, number, number, number, number];

function multiply(m1: Matrix, m2: readonly number[]): Matrix {
  const [a, b, c, d, e, f] = m1;
  const [a2 = 1, b2 = 0, c2 = 0, d2 = 1, e2 = 0, f2 = 0] = m2;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}

interface PositionedItem {
  text: string;
  left: number;
  right: number;
  baseline: number;
  fontHeight: number;
  hasEOL: boolean;
}

/**
 * Rebuilds visual lines from pdf.js text items, in content-stream order (keeps columns apart).
 * `viewportTransform` maps PDF user space to top-left based coordinates (viewport.transform at scale 1).
 * A new line starts after an explicit end-of-line, when the baseline moves by more than half a font height,
 * when the text goes back to the left, or when a horizontal gap looks like a column gutter.
 */
export function textItemsToLines(items: readonly PdfTextItemLike[], viewportTransform: readonly number[]): LayoutLine[] {
  const vt: Matrix = [
    viewportTransform[0] ?? 1, viewportTransform[1] ?? 0, viewportTransform[2] ?? 0,
    viewportTransform[3] ?? -1, viewportTransform[4] ?? 0, viewportTransform[5] ?? 0,
  ];
  const positioned: PositionedItem[] = [];
  for (const item of items) {
    const tx = multiply(vt, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(item.height) || 10;
    const scaleX = Math.hypot(vt[0], vt[1]) || 1;
    positioned.push({
      text: item.str,
      left: tx[4],
      right: tx[4] + Math.abs(item.width) * scaleX,
      baseline: tx[5],
      fontHeight,
      hasEOL: item.hasEOL === true,
    });
  }

  const lines: LayoutLine[] = [];
  let current: { parts: string[]; left: number; right: number; baseline: number; fontHeight: number } | null = null;
  let breakPending = false;

  const flush = (): void => {
    if (!current) return;
    const text = current.parts.join('').replace(/\s+/g, ' ').trim();
    if (text.length > 0) {
      lines.push({
        text,
        top: current.baseline - current.fontHeight,
        height: current.fontHeight,
        left: current.left,
        fontSize: Math.round(current.fontHeight * 100) / 100,
      });
    }
    current = null;
  };

  for (const item of positioned) {
    const isBlank = item.text.trim().length === 0;
    if (isBlank && current === null) {
      if (item.hasEOL) breakPending = false;
      continue;
    }
    if (current !== null) {
      const fh = Math.max(current.fontHeight, item.fontHeight);
      const sameBaseline = Math.abs(item.baseline - current.baseline) <= fh * 0.5;
      const backwards = item.left < current.right - fh * 1.5;
      const gutter = item.left - current.right > fh * 3;
      if (breakPending || (!isBlank && (!sameBaseline || backwards || gutter))) flush();
    }
    breakPending = false;
    if (current === null) {
      if (isBlank) continue;
      current = { parts: [], left: item.left, right: item.left, baseline: item.baseline, fontHeight: item.fontHeight };
    }
    const gap = item.left - current.right;
    const needsSpace =
      current.parts.length > 0 &&
      gap > item.fontHeight * 0.15 &&
      !/\s$/.test(current.parts[current.parts.length - 1] ?? '') &&
      !/^\s/.test(item.text);
    if (needsSpace) current.parts.push(' ');
    current.parts.push(item.text);
    current.right = Math.max(current.right, item.right);
    current.fontHeight = Math.max(current.fontHeight, item.fontHeight);
    if (item.hasEOL) breakPending = true;
  }
  flush();
  return lines;
}

export interface PdfHandle {
  readonly numPages: number;
  /** Text lines of a page (0-based index). */
  getPageLines(pageIndex: number): Promise<LayoutLine[]>;
  /** Renders a page (0-based) with its long side ≤ maxSide. */
  renderPage(pageIndex: number, maxSide?: number): Promise<RgbaImage>;
  destroy(): Promise<void>;
}

export class PdfUnreadableError extends Error {
  constructor(message = 'pdf_unreadable') {
    super(message);
    this.name = 'PdfUnreadableError';
  }
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, worker] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

function releaseCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

export async function openPdf(source: Blob | ArrayBuffer | Uint8Array): Promise<PdfHandle> {
  const pdfjs = await loadPdfJs();
  const bytes =
    source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : source instanceof Uint8Array ? source : new Uint8Array(source);
  // Options of §15.6. `isEvalSupported` is kept for older pdf.js builds that still read it.
  const params: DocumentInitParameters & { isEvalSupported: boolean; enableScripting: boolean } = {
    data: bytes,
    wasmUrl: '/pdfjs/wasm/',
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    iccUrl: '/pdfjs/iccs/',
    isEvalSupported: false,
    enableScripting: false,
  };
  let doc: Awaited<ReturnType<PdfJs['getDocument']>['promise']>;
  const task = pdfjs.getDocument(params);
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    throw new PdfUnreadableError(error instanceof Error ? error.name : 'pdf_unreadable');
  }

  return {
    numPages: doc.numPages,

    async getPageLines(pageIndex: number): Promise<LayoutLine[]> {
      const page = await doc.getPage(pageIndex + 1);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items = content.items.filter((item): item is TextItem => 'str' in item);
        return textItemsToLines(items, viewport.transform);
      } finally {
        page.cleanup();
      }
    },

    async renderPage(pageIndex: number, maxSide = PDF_RENDER_MAX_SIDE): Promise<RgbaImage> {
      const page = await doc.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, maxSide / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      try {
        await page.render({ canvas, viewport, background: '#ffffff' }).promise;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new PdfUnreadableError('canvas_unavailable');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { data: imageData.data, width: imageData.width, height: imageData.height };
      } finally {
        releaseCanvas(canvas);
        page.cleanup();
      }
    },

    async destroy(): Promise<void> {
      try {
        await task.destroy();
      } catch {
        // Already destroyed.
      }
    },
  };
}

/** Page count only (import). */
export async function countPdfPages(source: Blob): Promise<number> {
  const handle = await openPdf(source);
  try {
    return handle.numPages;
  } finally {
    await handle.destroy();
  }
}
