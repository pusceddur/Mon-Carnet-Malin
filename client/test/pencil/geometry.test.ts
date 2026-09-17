import type { InkPoint } from '@aide/shared';
import { describe, expect, it } from 'vitest';
import {
  boundingBox,
  capPointCount,
  densify,
  distance,
  distanceToRect,
  distanceToSegment,
  hitTestStroke,
  pathLength,
  polylineDistance,
  polylineToRectDistance,
  segmentsIntersect,
  simplifyStroke,
  splitStroke,
} from '../../src/pencil/geometry';

const pts = (...coords: [number, number, number?][]): InkPoint[] => coords.map(([x, y, p]) => ({ x, y, p: p ?? 0.5 }));

function horizontal(fromX: number, toX: number, y: number, step = 5): InkPoint[] {
  const out: InkPoint[] = [];
  for (let x = fromX; x <= toX; x += step) out.push({ x, y, p: 0.5 });
  return out;
}

describe('distances', () => {
  it('computes the distance from a point to a segment, including the ends and degenerate segments', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3);
    expect(distanceToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5);
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5);
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5);
  });

  it('detects crossing, touching and separate segments', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 })).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBe(false);
    expect(polylineDistance(pts([0, 0], [10, 0]), pts([5, -5], [5, 5]))).toBe(0);
    expect(polylineDistance(pts([0, 0], [10, 0]), pts([0, 4], [10, 4]))).toBeCloseTo(4);
  });

  it('measures rectangles and polylines against rectangles', () => {
    const rect = { left: 10, top: 10, width: 20, height: 10 };
    expect(distanceToRect({ x: 15, y: 15 }, rect)).toBe(0);
    expect(distanceToRect({ x: 0, y: 15 }, rect)).toBe(10);
    expect(distanceToRect({ x: 33, y: 24 }, rect)).toBeCloseTo(5);
    expect(polylineToRectDistance(pts([0, 15], [50, 15]), rect)).toBe(0);
    expect(polylineToRectDistance(pts([0, 30], [50, 30]), rect)).toBeCloseTo(10);
  });

  it('computes bounding boxes and path length', () => {
    expect(boundingBox([])).toBeNull();
    expect(boundingBox(pts([3, 4], [-1, 8], [5, 0]))).toEqual({ minX: -1, minY: 0, maxX: 5, maxY: 8 });
    expect(pathLength(pts([0, 0], [3, 4], [3, 10]))).toBeCloseTo(11);
  });
});

describe('hitTestStroke', () => {
  const stroke = horizontal(0, 100, 50);

  it('hits when the eraser reaches the stroke edge (radius + half width)', () => {
    expect(hitTestStroke(stroke, 6, [{ x: 50, y: 60 }], 8)).toBe(true); // 10 <= 8 + 3
    expect(hitTestStroke(stroke, 2, [{ x: 50, y: 60 }], 8)).toBe(false); // 10 > 8 + 1
  });

  it('hits when a fast eraser segment crosses the stroke between two samples', () => {
    expect(hitTestStroke(stroke, 2, [{ x: 50, y: 0 }, { x: 50, y: 100 }], 2)).toBe(true);
  });

  it('ignores far strokes', () => {
    expect(hitTestStroke(stroke, 2, [{ x: 500, y: 500 }], 20)).toBe(false);
    expect(hitTestStroke([], 2, [{ x: 0, y: 0 }], 20)).toBe(false);
  });
});

describe('splitStroke (partial eraser)', () => {
  it('returns null when the stroke is untouched', () => {
    expect(splitStroke(horizontal(0, 100, 50), [{ x: 50, y: 90 }], 10)).toBeNull();
  });

  it('cuts a line in two fragments whose ends lie on the eraser boundary', () => {
    const fragments = splitStroke(horizontal(0, 100, 50), [{ x: 50, y: 50 }], 10);
    expect(fragments).not.toBeNull();
    expect(fragments).toHaveLength(2);
    const [left, right] = fragments!;
    expect(left![0]!.x).toBeCloseTo(0);
    expect(left![left!.length - 1]!.x).toBeCloseTo(40, 0);
    expect(right![0]!.x).toBeCloseTo(60, 0);
    expect(right![right!.length - 1]!.x).toBeCloseTo(100);
    for (const f of fragments!) for (const p of f) expect(distance(p, { x: 50, y: 50 })).toBeGreaterThanOrEqual(9.9);
  });

  it('cuts between sparse samples (long segment crossing the eraser)', () => {
    const fragments = splitStroke(pts([0, 0], [200, 0]), [{ x: 100, y: 0 }], 5);
    expect(fragments).toHaveLength(2);
  });

  it('erases the whole stroke and single dots', () => {
    expect(splitStroke(horizontal(0, 10, 0, 1), [{ x: 5, y: 0 }], 30)).toEqual([]);
    expect(splitStroke(pts([5, 5]), [{ x: 6, y: 6 }], 3)).toEqual([]);
    expect(splitStroke(pts([5, 5]), [{ x: 60, y: 60 }], 3)).toBeNull();
  });

  it('follows a long eraser path and interpolates pressure', () => {
    const stroke = pts([0, 0, 0], [100, 0, 1]);
    const eraserPath = [{ x: 30, y: -20 }, { x: 30, y: 20 }, { x: 70, y: 20 }, { x: 70, y: -20 }];
    const fragments = splitStroke(stroke, eraserPath, 5)!;
    // Only the two vertical passes cross the line: left, middle and right parts remain.
    expect(fragments).toHaveLength(3);
    const [left, middle, right] = fragments;
    expect(left![left!.length - 1]!.x).toBeCloseTo(25, 0);
    expect(middle![0]!.x).toBeCloseTo(35, 0);
    expect(middle![middle!.length - 1]!.x).toBeCloseTo(65, 0);
    expect(right![right!.length - 1]!.p).toBeCloseTo(1);
    expect(right![0]!.p).toBeCloseTo(0.75, 1);
  });
});

describe('simplifyStroke', () => {
  it('drops collinear points but keeps corners and endpoints', () => {
    const input = [...horizontal(0, 100, 0, 1), ...pts([100, 50])];
    const out = simplifyStroke(input, 0.5);
    expect(out[0]).toEqual(input[0]);
    expect(out[out.length - 1]).toEqual({ x: 100, y: 50, p: 0.5 });
    expect(out.some((p) => p.x === 100 && p.y === 0)).toBe(true);
    expect(out.length).toBeLessThan(5);
  });

  it('keeps pressure changes on a straight line', () => {
    const input = pts([0, 0, 0.2], [10, 0, 0.2], [20, 0, 0.9], [30, 0, 0.2], [40, 0, 0.2]);
    expect(simplifyStroke(input, 1).some((p) => p.p === 0.9)).toBe(true);
  });

  it('caps the number of points', () => {
    const noisy: InkPoint[] = [];
    for (let i = 0; i < 5000; i++) noisy.push({ x: i, y: Math.sin(i) * 3, p: 0.5 });
    expect(capPointCount(noisy, 500, 0.1).length).toBeLessThanOrEqual(500);
  });

  it('densifies long segments', () => {
    const out = densify(pts([0, 0], [10, 0]), 2);
    expect(out).toHaveLength(6);
    expect(out[2]!.x).toBeCloseTo(4);
  });
});
