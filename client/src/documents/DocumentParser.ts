// Turns extracted PDF lines / OCR output into page blocks, and classifies imported files.
import {
  buildBlocksFromLines,
  normalizeDisplayText,
  normalizeForMatch,
  sha256Hex,
  type LayoutLine,
  type PageContent,
  type PageStatus,
  type PageWarning,
  type TextBlock,
} from '@aide/shared';
import { ocrLinesToLayoutLines, type OcrLine } from '../ocr/ocrLines';

/** A PDF page is read as text (no OCR) when it has at least this many letters (contract §11.2). */
export const MIN_PDF_TEXT_LETTERS = 40;

export function countLetters(text: string): number {
  let count = 0;
  for (const _ of text.matchAll(/\p{L}/gu)) count++;
  return count;
}

export function hasUsablePdfText(lines: readonly LayoutLine[]): boolean {
  let letters = 0;
  for (const line of lines) {
    letters += countLetters(line.text);
    if (letters >= MIN_PDF_TEXT_LETTERS) return true;
  }
  return false;
}

/** Cleans block texts and drops empty blocks. */
export function cleanBlocks(blocks: readonly TextBlock[]): TextBlock[] {
  return blocks
    .map((b) => ({ kind: b.kind, text: normalizeDisplayText(b.text) }))
    .filter((b) => b.text.length > 0);
}

export function blocksFromLayoutLines(lines: readonly LayoutLine[]): TextBlock[] {
  const cleaned = lines
    .map((l) => ({ ...l, text: normalizeDisplayText(l.text) }))
    .filter((l) => l.text.length > 0);
  return cleanBlocks(buildBlocksFromLines(cleaned));
}

export function blocksFromOcrLines(lines: readonly OcrLine[]): TextBlock[] {
  return blocksFromLayoutLines(ocrLinesToLayoutLines(lines));
}

/** sha256(normalizeForMatch(blocks.map(b => b.text).join('\n\n'))) — contract §5. */
export function computeContentHash(blocks: readonly TextBlock[]): Promise<string> {
  return sha256Hex(normalizeForMatch(blocks.map((b) => b.text).join('\n\n')));
}

export function pendingPage(documentId: string, pageIndex: number, now: number): PageContent {
  return {
    documentId,
    pageIndex,
    status: 'pending',
    textSource: null,
    blocks: [],
    confidence: null,
    contentHash: null,
    width: null,
    height: null,
    warnings: [],
    updatedAt: now,
  };
}

export const AVAILABLE_STATUSES: ReadonlySet<PageStatus> = new Set(['ready', 'low_confidence']);
export const DOUBTFUL_WARNINGS: ReadonlySet<PageWarning> = new Set(['low_confidence', 'no_text_found', 'suspicious_instructions']);

/** Page the parent should look at (filter « À vérifier »). */
export function isDoubtfulPage(page: PageContent): boolean {
  return page.status === 'low_confidence' || page.status === 'failed' || page.warnings.some((w) => DOUBTFUL_WARNINGS.has(w));
}

// ---------- files ----------

export type ImportFileKind = 'pdf' | 'image' | 'epub';

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?)$/i;
export const EPUB_MIME = 'application/epub+zip';

/** The iPad file picker may give an empty MIME type: the extension decides then. */
export function detectFileKind(file: { type: string; name: string }): ImportFileKind | null {
  const type = file.type.toLowerCase();
  if (type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (type === EPUB_MIME || /\.epub$/i.test(file.name)) return 'epub';
  if (type.startsWith('image/') || IMAGE_EXTENSIONS.test(file.name)) return 'image';
  return null;
}

export function isHeic(file: { type: string; name: string }): boolean {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/** « Ma leçon.pdf » → « Ma leçon ». */
export function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]{1,5}$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
