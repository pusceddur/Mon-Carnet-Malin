// Pure 2D geometry for ink strokes: distances, hit tests, partial eraser split, bounding boxes, simplification.
import type { InkPoint } from '@aide/shared';

export interface Pt { x: number; y: number }
export interface Box { minX: number; minY: number; maxX: number; maxY: number }
export interface Rect { left: number; top: number; width: number; height: number }

export function distanceSq(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a: Pt, b: Pt): number {
  return Math.sqrt(distanceSq(a, b));
}

/** Distance from `p` to the segment [a, b] (a degenerate segment is a point). */
export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** True when the closed segments [a, b] and [c, d] intersect (including touching and collinear overlap). */
export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (
    (d1 === 0 && onSegment(c, d, a)) ||
    (d2 === 0 && onSegment(c, d, b)) ||
    (d3 === 0 && onSegment(a, b, c)) ||
    (d4 === 0 && onSegment(a, b, d))
  );
}

function onSegment(a: Pt, b: Pt, p: Pt): boolean {
  return Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
}

export function segmentToSegmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b));
}

/** Distance from `p` to a polyline (a single point counts as a polyline). Infinity for an empty polyline. */
export function distanceToPolyline(p: Pt, line: readonly Pt[]): number {
  const first = line[0];
  if (!first) return Infinity;
  if (line.length === 1) return distance(p, first);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = distanceToSegment(p, line[i - 1]!, line[i]!);
    if (d < best) best = d;
  }
  return best;
}

export function boundingBox(points: readonly Pt[]): Box | null {
  const first = points[0];
  if (!first) return null;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function expandBox(b: Box, r: number): Box {
  return { minX: b.minX - r, minY: b.minY - r, maxX: b.maxX + r, maxY: b.maxY + r };
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

export function boxCenter(b: Box): Pt {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Distance from `p` to a rectangle (0 inside). */
export function distanceToRect(p: Pt, r: Rect): number {
  const dx = Math.max(r.left - p.x, 0, p.x - (r.left + r.width));
  const dy = Math.max(r.top - p.y, 0, p.y - (r.top + r.height));
  return Math.hypot(dx, dy);
}

export function rectContains(r: Rect, p: Pt): boolean {
  return p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height;
}

/** Distance from the segment [a, b] to a rectangle (0 when it crosses or lies inside). */
export function segmentToRectDistance(a: Pt, b: Pt, r: Rect): number {
  if (rectContains(r, a) || rectContains(r, b)) return 0;
  const tl = { x: r.left, y: r.top };
  const tr = { x: r.left + r.width, y: r.top };
  const br = { x: r.left + r.width, y: r.top + r.height };
  const bl = { x: r.left, y: r.top + r.height };
  return Math.min(
    segmentToSegmentDistance(a, b, tl, tr),
    segmentToSegmentDistance(a, b, tr, br),
    segmentToSegmentDistance(a, b, br, bl),
    segmentToSegmentDistance(a, b, bl, tl),
  );
}

/** Distance from a polyline to a rectangle. */
export function polylineToRectDistance(line: readonly Pt[], r: Rect): number {
  const first = line[0];
  if (!first) return Infinity;
  if (line.length === 1) return distanceToRect(first, r);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = segmentToRectDistance(line[i - 1]!, line[i]!, r);
    if (d === 0) return 0;
    if (d < best) best = d;
  }
  return best;
}

/** Smallest distance between two polylines (points count as polylines). */
export function polylineDistance(a: readonly Pt[], b: readonly Pt[]): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  if (a.length === 1) return distanceToPolyline(a[0]!, b);
  if (b.length === 1) return distanceToPolyline(b[0]!, a);
  let best = Infinity;
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const d = segmentToSegmentDistance(a[i - 1]!, a[i]!, b[j - 1]!, b[j]!);
      if (d === 0) return 0;
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * True when the eraser path (with radius `eraserRadius`) touches the rendered stroke (points + full width).
 * A bounding-box test rejects far strokes before the segment tests.
 */
export function hitTestStroke(stroke: readonly Pt[], strokeWidth: number, eraser: readonly Pt[], eraserRadius: number): boolean {
  const sb = boundingBox(stroke);
  const eb = boundingBox(eraser);
  if (!sb || !eb) return false;
  const reach = eraserRadius + strokeWidth / 2;
  if (!boxesIntersect(expandBox(sb, reach), eb)) return false;
  return polylineDistance(stroke, eraser) <= reach;
}

export function pathLength(points: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!);
  return total;
}

export function lerpPoint(a: InkPoint, b: InkPoint, t: number): InkPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t };
}

/** Inserts interpolated points so that no segment is longer than `maxStep`. */
export function densify(points: readonly InkPoint[], maxStep: number): InkPoint[] {
  const first = points[0];
  if (!first || maxStep <= 0) return points.slice();
  const out: InkPoint[] = [first];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const steps = Math.ceil(distance(a, b) / maxStep);
    for (let s = 1; s < steps; s++) out.push(lerpPoint(a, b, s / steps));
    out.push(b);
  }
  return out;
}

/**
 * Partial eraser: removes the parts of the stroke closer than `radius` to the eraser path.
 * Returns null when the stroke is untouched, otherwise the remaining fragments (possibly none).
 * Fragment ends are placed on the eraser boundary (bisection), so the cut follows the eraser.
 */
export function splitStroke(points: readonly InkPoint[], eraser: readonly Pt[], radius: number): InkPoint[][] | null {
  const sb = boundingBox(points);
  const eb = boundingBox(eraser);
  if (!sb || !eb || !boxesIntersect(expandBox(sb, radius), eb)) return null;

  // Only the eraser segments near the stroke matter (long eraser gestures stay cheap).
  const near = expandBox(sb, radius);
  const segments: [Pt, Pt][] = [];
  if (eraser.length === 1) segments.push([eraser[0]!, eraser[0]!]);
  for (let i = 1; i < eraser.length; i++) {
    const a = eraser[i - 1]!;
    const b = eraser[i]!;
    const segmentBox = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    if (boxesIntersect(segmentBox, near)) segments.push([a, b]);
  }
  if (segments.length === 0) return null;
  const inside = (p: Pt): boolean => segments.some(([a, b]) => distanceToSegment(p, a, b) <= radius);
  if (points.length === 1) return inside(points[0]!) ? [] : null;

  const dense = densify(points, Math.max(radius / 2, 0.25));
  const flags = dense.map(inside);
  if (!flags.includes(true)) return null;

  const boundary = (outsidePt: InkPoint, insidePt: InkPoint): InkPoint => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 10; k++) {
      const mid = (lo + hi) / 2;
      if (inside(lerpPoint(outsidePt, insidePt, mid))) hi = mid;
      else lo = mid;
    }
    return lerpPoint(outsidePt, insidePt, lo);
  };

  const fragments: InkPoint[][] = [];
  let current: InkPoint[] = [];
  for (let i = 0; i < dense.length; i++) {
    const p = dense[i]!;
    if (flags[i]) {
      if (current.length > 0) {
        current.push(boundary(dense[i - 1]!, p));
        fragments.push(current);
        current = [];
      }
      continue;
    }
    if (i > 0 && flags[i - 1]) current.push(boundary(p, dense[i - 1]!));
    current.push(p);
  }
  if (current.length > 0) fragments.push(current);

  return fragments.filter((f) => f.length >= 2 && pathLength(f) > Math.max(radius * 0.1, 0.5)).map((f) => dedupe(f));
}

function dedupe(points: InkPoint[]): InkPoint[] {
  const out: InkPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

/**
 * Ramer–Douglas–Peucker simplification that also keeps pressure changes larger than `pressureEpsilon`.
 * Iterative (no recursion depth issue on long strokes). Endpoints are always kept.
 */
export function simplifyStroke(points: readonly InkPoint[], epsilon: number, pressureEpsilon = 0.05): InkPoint[] {
  if (points.length <= 2 || epsilon <= 0) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const a = points[start]!;
    const b = points[end]!;
    let maxScore = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!;
      const d = distanceToSegment(p, a, b) / epsilon;
      const t = (i - start) / (end - start);
      const dp = Math.abs(p.p - (a.p + (b.p - a.p) * t)) / pressureEpsilon;
      const score = Math.max(d, dp);
      if (score > maxScore) {
        maxScore = score;
        index = i;
      }
    }
    if (index !== -1 && maxScore > 1) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Simplifies with a growing epsilon until the stroke has at most `maxPoints` points. */
export function capPointCount(points: readonly InkPoint[], maxPoints: number, epsilon: number): InkPoint[] {
  let eps = Math.max(epsilon, 1e-6);
  let out = simplifyStroke(points, eps);
  while (out.length > maxPoints) {
    eps *= 2;
    out = simplifyStroke(out, eps, 1);
  }
  return out;
}
