// « Envoyer ou imprimer » (§19.3): every page in color with the child's ink and text boxes, in one PDF that the iPad share
// sheet sends (Mail, AirDrop, Imprimer…) or that is downloaded when files cannot be shared.
import type { DocumentMeta, Id, TextBoxAnnotation } from '@aide/shared';
import { fetchPageImage } from '../../api/documents';
import { db } from '../../db/localDb';
import { fromOriginalSpace } from '../../pencil/anchoring';
import { strokePath } from '../../pencil/DrawingEngine';
import { buildImagePdf, wrapText, type PdfImagePage } from './pdf';

const EXPORT_MAX_SIDE = 2000;
const JPEG_QUALITY = 0.85;
/** Same box geometry as `.tb-box__text` (line height, padding in em, 2 px border). */
const LINE_HEIGHT = 1.3;
const PADDING_EM = { x: 0.25, y: 0.1 };
const BORDER_PX = 2;

/** Color copy, else the grayscale page, else the server copy. */
async function pageImage(documentId: Id, pageIndex: number): Promise<Blob | null> {
  const record = (await db.pageImages.get([documentId, pageIndex, 'color'])) ?? (await db.pageImages.get([documentId, pageIndex, 'ocr']));
  return record ? record.blob : fetchPageImage(documentId, pageIndex);
}

function readingFont(): string {
  const css = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue('--read-font').trim();
  return css || 'sans-serif';
}

/** One page of the homework as the child sees it on the original view. Null when the page image is not available. */
export async function renderHomeworkPage(documentId: Id, childId: Id, pageIndex: number): Promise<PdfImagePage | null> {
  const blob = await pageImage(documentId, pageIndex);
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, EXPORT_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const annotations = await db.annotations
      .where('[documentId+childId]')
      .equals([documentId, childId])
      .filter((a) => a.deletedAt === null)
      .toArray();
    const frame = { left: 0, top: 0, width, height };
    for (const a of annotations) {
      if (a.type !== 'ink' || a.space.kind !== 'original' || a.space.pageIndex !== pageIndex) continue;
      const { points, widthPx } = fromOriginalSpace(a.points, a.width, frame);
      const d = strokePath(points, a.tool, widthPx);
      if (!d) continue;
      ctx.save();
      ctx.globalAlpha = a.opacity;
      ctx.globalCompositeOperation = a.tool === 'highlighter' ? 'multiply' : 'source-over';
      ctx.fillStyle = a.color;
      ctx.fill(new Path2D(d));
      ctx.restore();
    }

    const font = readingFont();
    const boxes = annotations
      .filter((a): a is TextBoxAnnotation => a.type === 'textbox' && a.pageIndex === pageIndex && a.text.trim() !== '')
      .sort((x, y) => x.createdAt - y.createdAt);
    for (const box of boxes) {
      const fontPx = box.fontSize * width;
      const lineHeight = fontPx * LINE_HEIGHT;
      const padX = PADDING_EM.x * fontPx + BORDER_PX;
      const padY = PADDING_EM.y * fontPx + BORDER_PX;
      ctx.save();
      ctx.font = `${fontPx}px ${font}`;
      ctx.fillStyle = box.color;
      ctx.textBaseline = 'middle';
      const lines = wrapText(box.text, box.width * width - 2 * padX, (s) => ctx.measureText(s).width);
      lines.forEach((line, i) => ctx.fillText(line, box.x * width + padX, box.y * height + padY + (i + 0.5) * lineHeight));
      ctx.restore();
    }

    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    return jpeg ? { jpeg: new Uint8Array(await jpeg.arrayBuffer()), width, height } : null;
  } finally {
    bitmap.close();
  }
}

/** File name from the title (characters refused by file systems removed). */
export function homeworkFileName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${clean || 'Devoir'}.pdf`;
}

/** The whole homework as a PDF file. Throws when no page image is available. */
export async function exportHomework(doc: DocumentMeta, childId: Id): Promise<File> {
  const pages: PdfImagePage[] = [];
  for (let pageIndex = 0; pageIndex < doc.pageCount; pageIndex++) {
    const page = await renderHomeworkPage(doc.id, childId, pageIndex);
    if (page) pages.push(page);
  }
  if (pages.length === 0) throw new Error('no_page_image');
  return new File([buildImagePdf(pages, doc.title)], homeworkFileName(doc.title), { type: 'application/pdf' });
}

export function canShareFile(file: File): boolean {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { canShare?(data: ShareData): boolean });
  return typeof nav?.share === 'function' && nav.canShare?.({ files: [file] }) === true;
}

/**
 * Share sheet of the iPad (call it from the tap: sharing needs a user gesture). Resolves false when sharing is not possible
 * or failed (the caller offers the download), true when shared or cancelled by the child.
 */
export async function shareFile(file: File, title: string): Promise<boolean> {
  if (!canShareFile(file)) return false;
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError';
  }
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
