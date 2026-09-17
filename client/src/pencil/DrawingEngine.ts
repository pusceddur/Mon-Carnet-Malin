// Stroke construction from pointer events and rendering to SVG paths with perfect-freehand.
import type { InkPoint, InkTool } from '@aide/shared';
import { getStroke, type StrokeOptions } from 'perfect-freehand';
import { capPointCount, distance } from './geometry';
import { TOOL_PRESETS } from './Tools';

/** §15.7: simulate pressure when the variance of the first 8 pressures is below 0.01 (e.g. Pencil USB-C, finger, mouse). */
export const PRESSURE_SAMPLE_COUNT = 8;
export const PRESSURE_VARIANCE_THRESHOLD = 0.01;
/** InkAnnotation.points max length (schema). */
export const MAX_STROKE_POINTS = 20_000;

export function pressureVariance(points: readonly Pick<InkPoint, 'p'>[], count = PRESSURE_SAMPLE_COUNT): number {
  const sample = points.slice(0, count);
  if (sample.length === 0) return 0;
  const mean = sample.reduce((sum, pt) => sum + pt.p, 0) / sample.length;
  return sample.reduce((sum, pt) => sum + (pt.p - mean) ** 2, 0) / sample.length;
}

export function shouldSimulatePressure(points: readonly Pick<InkPoint, 'p'>[]): boolean {
  return pressureVariance(points) < PRESSURE_VARIANCE_THRESHOLD;
}

/** All samples carried by a pointermove: coalesced events when the browser provides them, otherwise the event itself. */
export function pointerSamples(event: PointerEvent): PointerEvent[] {
  // Feature detection: getCoalescedEvents is missing on older engines.
  const e = event as { getCoalescedEvents?: unknown } & PointerEvent;
  if (typeof e.getCoalescedEvents === 'function') {
    try {
      const list = event.getCoalescedEvents();
      if (list.length > 0) return list;
    } catch {
      // Some engines throw for untrusted events.
    }
  }
  return [event];
}

/** Pressure in 0..1. Mouse and devices without pressure report 0.5 while pressed (constant ⇒ simulated later). */
export function pointerPressure(pointerType: string, pressure: number): number {
  if (!Number.isFinite(pressure)) return 0.5;
  if (pointerType !== 'pen' && (pressure === 0 || pressure === 0.5)) return 0.5;
  return Math.min(1, Math.max(0, pressure));
}

/** Collects the points of the stroke being drawn (surface px). Very close points are merged. */
export class StrokeBuilder {
  private readonly pts: InkPoint[] = [];

  constructor(private readonly minDistance = 0.5) {}

  add(x: number, y: number, p: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const last = this.pts[this.pts.length - 1];
    if (last && distance(last, { x, y }) < this.minDistance) {
      // Same place: keep the strongest pressure (a pen pressing harder without moving).
      if (p > last.p) last.p = p;
      return false;
    }
    this.pts.push({ x, y, p });
    return true;
  }

  get points(): readonly InkPoint[] {
    return this.pts;
  }

  get size(): number {
    return this.pts.length;
  }
}

/** Moving average over 3 points (endpoints kept): removes digitizer jitter without visible lag. */
export function smoothPoints(points: readonly InkPoint[]): InkPoint[] {
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const out: InkPoint[] = [{ ...points[0]! }];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    out.push({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, p: b.p });
  }
  out.push({ ...points[points.length - 1]! });
  return out;
}

/** Points ready to be stored: smoothed, simplified (sub-pixel tolerance), within the schema limit. */
export function finalizeStrokePoints(points: readonly InkPoint[]): InkPoint[] {
  return capPointCount(smoothPoints(points), MAX_STROKE_POINTS, 0.2);
}

export function strokeOptions(tool: InkTool, sizePx: number, points: readonly Pick<InkPoint, 'p'>[], last: boolean): StrokeOptions {
  const preset = TOOL_PRESETS[tool];
  const simulate = preset.usesPressure && shouldSimulatePressure(points);
  return {
    size: Math.max(sizePx, 0.5),
    thinning: preset.usesPressure ? (simulate ? preset.thinning * 0.5 : preset.thinning) : 0,
    smoothing: preset.smoothing,
    streamline: preset.streamline,
    easing: preset.easing,
    simulatePressure: simulate,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
    last,
  };
}

function average(a: number, b: number): number {
  return (a + b) / 2;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Closed SVG path through the outline polygon (quadratic curves through edge midpoints). */
export function outlineToSvgPath(outline: readonly (readonly number[])[]): string {
  const len = outline.length;
  if (len < 3) return '';
  const p0 = outline[0]!;
  const p1 = outline[1]!;
  const p2 = outline[2]!;
  let d = `M${fmt(p0[0]!)},${fmt(p0[1]!)} Q${fmt(p1[0]!)},${fmt(p1[1]!)} ${fmt(average(p1[0]!, p2[0]!))},${fmt(average(p1[1]!, p2[1]!))} T`;
  for (let i = 2; i < len - 1; i++) {
    const a = outline[i]!;
    const b = outline[i + 1]!;
    d += `${fmt(average(a[0]!, b[0]!))},${fmt(average(a[1]!, b[1]!))} `;
  }
  return `${d.trimEnd()} Z`;
}

/** SVG path (fill) of a stroke given in px. Highlighter: constant pressure. */
export function strokePath(points: readonly InkPoint[], tool: InkTool, widthPx: number, last = true): string {
  if (points.length === 0) return '';
  const input = TOOL_PRESETS[tool].usesPressure ? points.map((p) => [p.x, p.y, p.p]) : points.map((p) => [p.x, p.y, 0.5]);
  return outlineToSvgPath(getStroke(input, strokeOptions(tool, widthPx, points, last)));
}

/** Joins the paths of several fragments (partial eraser preview). */
export function fragmentsPath(fragments: readonly (readonly InkPoint[])[], tool: InkTool, widthPx: number): string {
  return fragments
    .map((f) => strokePath(f, tool, widthPx, true))
    .filter(Boolean)
    .join(' ');
}
