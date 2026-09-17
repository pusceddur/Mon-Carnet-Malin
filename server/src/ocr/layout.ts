import { buildBlocksFromLines, joinOcrLines, type LayoutLine, type TextBlock } from '@aide/shared';

export interface OcrWord {
  text: string;
  /** 0..100 */
  confidence: number;
}

export interface OcrLine {
  text: string;
  top: number;
  left: number;
  width: number;
  height: number;
  /** Tesseract row height (proxy of the font size), null when unknown. */
  rowHeight: number | null;
  words: OcrWord[];
}

/** Recognition result kept in engine order: blocks → paragraphs → lines. */
export interface OcrPage {
  blocks: { paragraphs: OcrLine[][] }[];
}

// Minimal structural view of tesseract.js `blocks` output (only the fields used here).
interface TessBbox { x0: number; y0: number; x1: number; y1: number }
interface TessWord { text?: string | null; confidence?: number | null }
interface TessLine { words?: TessWord[] | null; bbox?: TessBbox | null; rowAttributes?: { rowHeight?: number | null } | null }
interface TessParagraph { lines?: TessLine[] | null }
export interface TessBlockLike { paragraphs?: TessParagraph[] | null }

const HAS_ALNUM = /[\p{L}\p{N}]/u;

function finite(n: unknown, fallback = 0): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** Converts tesseract.js `data.blocks` into lines (words re-joined with single spaces, noise lines dropped). */
export function pageFromTesseract(blocks: readonly TessBlockLike[] | null | undefined): OcrPage {
  const page: OcrPage = { blocks: [] };
  for (const block of blocks ?? []) {
    const paragraphs: OcrLine[][] = [];
    for (const paragraph of block.paragraphs ?? []) {
      const lines: OcrLine[] = [];
      for (const line of paragraph.lines ?? []) {
        const words: OcrWord[] = (line.words ?? [])
          .map((w) => ({ text: (w.text ?? '').trim(), confidence: Math.min(100, Math.max(0, finite(w.confidence))) }))
          .filter((w) => w.text.length > 0);
        const text = words.map((w) => w.text).join(' ');
        if (!HAS_ALNUM.test(text)) continue;
        const bbox = line.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
        const rowHeight = finite(line.rowAttributes?.rowHeight, 0);
        lines.push({
          text,
          top: finite(bbox.y0),
          left: finite(bbox.x0),
          width: Math.max(0, finite(bbox.x1) - finite(bbox.x0)),
          height: Math.max(0, finite(bbox.y1) - finite(bbox.y0)),
          rowHeight: rowHeight > 0 ? rowHeight : null,
          words,
        });
      }
      if (lines.length > 0) paragraphs.push(lines);
    }
    if (paragraphs.length > 0) page.blocks.push({ paragraphs });
  }
  return page;
}

function allWords(page: OcrPage): OcrWord[] {
  return page.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.flatMap((l) => l.words)));
}

/** Number of letters and digits recognized. */
export function pageCharCount(page: OcrPage): number {
  return allWords(page).reduce((sum, w) => sum + (w.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0), 0);
}

/** Mean word confidence weighted by word length (0..100, one decimal); 0 when nothing was read. */
export function pageConfidence(page: OcrPage): number {
  let weighted = 0;
  let total = 0;
  for (const w of allWords(page)) {
    const weight = Math.max(1, w.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0);
    weighted += w.confidence * weight;
    total += weight;
  }
  return total === 0 ? 0 : Math.round((weighted / total) * 10) / 10;
}

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function median(values: number[]): number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

interface Flow {
  lines: OcrLine[];
  left: number;
  right: number;
  bottom: number;
}

/**
 * Tesseract often returns one block per line on well-spaced pages. Consecutive blocks stacked below each other with
 * overlapping horizontal ranges form one text flow; a block that starts higher or beside (next column) starts a new one.
 */
export function groupTextFlows(page: OcrPage): OcrLine[][] {
  const flows: Flow[] = [];
  for (const block of page.blocks) {
    const lines = block.paragraphs.flat();
    if (lines.length === 0) continue;
    const left = Math.min(...lines.map((l) => l.left));
    const right = Math.max(...lines.map((l) => l.left + l.width));
    const top = Math.min(...lines.map((l) => l.top));
    const bottom = Math.max(...lines.map((l) => l.top + l.height));
    const lineHeight = median(lines.map((l) => l.height)) || 1;
    const last = flows[flows.length - 1];
    if (last) {
      const overlap = Math.min(last.right, right) - Math.max(last.left, left);
      const narrower = Math.max(1, Math.min(last.right - last.left, right - left));
      if (top >= last.bottom - lineHeight * 0.5 && overlap / narrower >= 0.3) {
        last.lines.push(...lines);
        last.left = Math.min(last.left, left);
        last.right = Math.max(last.right, right);
        last.bottom = Math.max(last.bottom, bottom);
        continue;
      }
    }
    flows.push({ lines: [...lines], left, right, bottom });
  }
  return flows.map((f) => f.lines);
}

/** Fallback paragraphs: a vertical gap larger than 0.8 line height starts a new paragraph. */
function paragraphsByGap(lines: OcrLine[]): OcrLine[][] {
  const lineHeight = median(lines.map((l) => l.height)) || 1;
  const groups: OcrLine[][] = [];
  let previous: OcrLine | null = null;
  for (const line of lines) {
    const current = groups[groups.length - 1];
    if (current && previous && line.top - (previous.top + previous.height) <= lineHeight * 0.8) current.push(line);
    else groups.push([line]);
    previous = line;
  }
  return groups;
}

/**
 * Text blocks for PageContent: each text flow (columns are never interleaved) goes through the shared layout
 * heuristics (paragraphs, titles, hyphenation); gap-based paragraphs joined with joinOcrLines are the fallback.
 */
export function pageToTextBlocks(page: OcrPage): TextBlock[] {
  const out: TextBlock[] = [];
  for (const lines of groupTextFlows(page)) {
    const layout: LayoutLine[] = lines.map((l) => ({
      text: l.text,
      top: l.top,
      left: l.left,
      height: l.height,
      ...(l.rowHeight !== null ? { fontSize: l.rowHeight } : {}),
    }));
    let blocks: TextBlock[] = [];
    try {
      blocks = buildBlocksFromLines(layout);
    } catch {
      blocks = [];
    }
    const usable = blocks.map((b) => ({ kind: b.kind, text: tidy(b.text) })).filter((b) => b.text.length > 0);
    if (usable.length > 0) {
      out.push(...usable);
      continue;
    }
    for (const paragraph of paragraphsByGap(lines)) {
      const text = tidy(joinOcrLines(paragraph.map((l) => l.text)));
      if (text.length > 0) out.push({ kind: 'paragraph', text });
    }
  }
  return out;
}
