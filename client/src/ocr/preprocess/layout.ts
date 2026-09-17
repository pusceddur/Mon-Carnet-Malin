// Column detection by recursive X-Y cuts. The OCR engine merges aligned lines of two columns into one line, so pages
// with columns are read region by region, in reading order (top to bottom, left column before right column).
import { downscaleForAnalysis } from './deskew';
import { otsuThreshold } from './filters';
import type { GrayImage, Rect } from './image';

interface Box { x0: number; y0: number; x1: number; y1: number }

export interface TextRegionOptions {
  analysisSide?: number;
  maxDepth?: number;
}

/**
 * Text regions in reading order, in image pixels. Returns an empty array when the page is a single region (the usual
 * case): the caller then reads the whole page at once.
 */
export function findTextRegions(img: GrayImage, options: TextRegionOptions = {}): Rect[] {
  const { analysisSide = 1000, maxDepth = 6 } = options;
  const small = downscaleForAnalysis(img, analysisSide);
  const { width: w, height: h, data } = small;
  const threshold = otsuThreshold(small);
  const ink = new Uint8Array(w * h);
  let inkTotal = 0;
  for (let i = 0; i < ink.length; i++) {
    if (data[i]! <= threshold) {
      ink[i] = 1;
      inkTotal++;
    }
  }
  if (inkTotal < 50 || inkTotal > ink.length * 0.5) return [];

  const rowInk = (box: Box): Uint32Array => {
    const out = new Uint32Array(box.y1 - box.y0);
    for (let y = box.y0; y < box.y1; y++) {
      let n = 0;
      for (let x = box.x0; x < box.x1; x++) n += ink[y * w + x]!;
      out[y - box.y0] = n;
    }
    return out;
  };
  const colInk = (box: Box): Uint32Array => {
    const out = new Uint32Array(box.x1 - box.x0);
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) out[x - box.x0] = out[x - box.x0]! + ink[y * w + x]!;
    }
    return out;
  };

  // Typical text line height: median height of runs of inked rows over the whole page.
  const allRows = rowInk({ x0: 0, y0: 0, x1: w, y1: h });
  const runs: number[] = [];
  const gaps: number[] = [];
  let run = 0;
  let gap = 0;
  for (let y = 0; y <= h; y++) {
    if (y < h && allRows[y]! > Math.max(1, w * 0.002)) {
      if (gap > 0 && runs.length > 0) gaps.push(gap);
      gap = 0;
      run++;
    } else {
      if (run > 0) runs.push(run);
      run = 0;
      gap++;
    }
  }
  if (runs.length < 2) return [];
  const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  const lineHeight = Math.max(3, median(runs));
  // Horizontal cuts only at gaps clearly wider than the space between two lines (sections, not lines).
  const minSectionGap = Math.max(lineHeight * 0.8, median(gaps) * 1.6);

  const trim = (box: Box): Box | null => {
    const rows = rowInk(box);
    const cols = colInk(box);
    const rowLimit = Math.max(0, Math.floor((box.x1 - box.x0) * 0.002));
    const colLimit = Math.max(0, Math.floor((box.y1 - box.y0) * 0.004));
    let y0 = 0;
    while (y0 < rows.length && rows[y0]! <= rowLimit) y0++;
    let y1 = rows.length;
    while (y1 > y0 && rows[y1 - 1]! <= rowLimit) y1--;
    let x0 = 0;
    while (x0 < cols.length && cols[x0]! <= colLimit) x0++;
    let x1 = cols.length;
    while (x1 > x0 && cols[x1 - 1]! <= colLimit) x1--;
    if (y1 - y0 < lineHeight * 0.5 || x1 - x0 < lineHeight) return null;
    return { x0: box.x0 + x0, y0: box.y0 + y0, x1: box.x0 + x1, y1: box.y0 + y1 };
  };

  /** Widest run of empty columns strictly inside the box, wide enough to be a gutter, with real text on both sides. */
  const verticalCut = (box: Box): number | null => {
    const cols = colInk(box);
    const limit = Math.max(0, Math.floor((box.y1 - box.y0) * 0.004));
    const minGap = Math.max(lineHeight * 1.5, w * 0.02);
    const minSide = lineHeight * 3;
    let best: { start: number; length: number } | null = null;
    let start = -1;
    for (let x = 0; x <= cols.length; x++) {
      const empty = x < cols.length && cols[x]! <= limit;
      if (empty && start < 0) start = x;
      if (!empty && start >= 0) {
        const length = x - start;
        const inside = start > 0 && x < cols.length;
        if (inside && length >= minGap && start >= minSide && cols.length - x >= minSide && (!best || length > best.length)) {
          best = { start, length };
        }
        start = -1;
      }
    }
    return best ? box.x0 + best.start + Math.floor(best.length / 2) : null;
  };

  const horizontalCuts = (box: Box): number[] => {
    const rows = rowInk(box);
    const limit = Math.max(0, Math.floor((box.x1 - box.x0) * 0.002));
    const cuts: number[] = [];
    let start = -1;
    for (let y = 0; y <= rows.length; y++) {
      const empty = y < rows.length && rows[y]! <= limit;
      if (empty && start < 0) start = y;
      if (!empty && start >= 0) {
        if (start > 0 && y < rows.length && y - start >= minSectionGap) cuts.push(box.y0 + start + Math.floor((y - start) / 2));
        start = -1;
      }
    }
    return cuts;
  };

  const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

  const split = (input: Box, depth: number): Box[] => {
    const box = trim(input);
    if (!box) return [];
    if (depth >= maxDepth) return [box];
    const v = verticalCut(box);
    if (v !== null) {
      return [...split({ ...box, x1: v }, depth + 1), ...split({ ...box, x0: v }, depth + 1)];
    }
    const cuts = horizontalCuts(box);
    if (cuts.length === 0) return [box];
    const edges = [box.y0, ...cuts, box.y1];
    const parts: Box[][] = [];
    for (let i = 0; i < edges.length - 1; i++) parts.push(split({ ...box, y0: edges[i]!, y1: edges[i + 1]! }, depth + 1));
    if (parts.every((p) => p.length <= 1)) return [box];
    // Consecutive bands with the same columns are joined (a column is read whole before the next one); full-width
    // bands stay separate; a short band under one column joins that column.
    const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1;
    const groups: Box[][] = [];
    let current: Box[] | null = null;
    for (const p of parts) {
      if (p.length === 0) continue;
      if (current && current.length === p.length && p.every((b, i) => overlaps(b, current![i]!))) {
        current = current.map((b, i) => union(b, p[i]!));
        continue;
      }
      if (current && current.length > 1 && p.length === 1) {
        const single = p[0]!;
        const column = current.findIndex((b) => overlaps(b, single) && single.x1 - single.x0 <= (b.x1 - b.x0) * 1.3);
        if (column >= 0 && current.every((b, i) => i === column || !overlaps(b, single))) {
          current = current.map((b, i) => (i === column ? union(b, single) : b));
          continue;
        }
      }
      if (current) groups.push(current);
      current = p;
    }
    if (current) groups.push(current);
    return groups.flat();
  };

  const boxes = split({ x0: 0, y0: 0, x1: w, y1: h }, 0);
  if (boxes.length <= 1) return [];
  const sx = img.width / w;
  const sy = img.height / h;
  const pad = lineHeight * 0.5;
  return boxes.map((b) => {
    const x = Math.max(0, Math.floor((b.x0 - pad) * sx));
    const y = Math.max(0, Math.floor((b.y0 - pad) * sy));
    const x1 = Math.min(img.width, Math.ceil((b.x1 + pad) * sx));
    const y1 = Math.min(img.height, Math.ceil((b.y1 + pad) * sy));
    return { x, y, width: x1 - x, height: y1 - y };
  });
}
