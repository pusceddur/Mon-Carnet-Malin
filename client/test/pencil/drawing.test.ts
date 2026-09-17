import type { InkPoint } from '@aide/shared';
import { describe, expect, it } from 'vitest';
import {
  MAX_STROKE_POINTS,
  StrokeBuilder,
  finalizeStrokePoints,
  pointerPressure,
  pointerSamples,
  pressureVariance,
  shouldSimulatePressure,
  smoothPoints,
  strokeOptions,
  strokePath,
} from '../../src/pencil/DrawingEngine';
import { HIGHLIGHTER_PALETTE, INK_PALETTE, TOOL_PRESETS, isInPalette, strokeWidthPx, thicknessEm } from '../../src/pencil/Tools';

const withPressures = (pressures: number[]): InkPoint[] => pressures.map((p, i) => ({ x: i * 4, y: 0, p }));

describe('pressure', () => {
  it('simulates pressure when the first 8 pressures barely vary (Pencil without pressure, finger, mouse)', () => {
    expect(shouldSimulatePressure(withPressures([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]))).toBe(true);
    expect(shouldSimulatePressure(withPressures([0.3, 0.32, 0.31, 0.3, 0.33, 0.29, 0.3, 0.31]))).toBe(true);
    expect(shouldSimulatePressure(withPressures([0.1, 0.4, 0.8, 0.3, 0.9, 0.2, 0.6, 0.1]))).toBe(false);
  });

  it('only looks at the first 8 points', () => {
    const points = withPressures([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0, 1, 0, 1]);
    expect(pressureVariance(points)).toBe(0);
    expect(shouldSimulatePressure(points)).toBe(true);
    expect(pressureVariance([])).toBe(0);
  });

  it('uses real pressure for pens and a neutral value for the other devices', () => {
    expect(pointerPressure('pen', 0.73)).toBe(0.73);
    expect(pointerPressure('pen', 1.4)).toBe(1);
    expect(pointerPressure('mouse', 0.5)).toBe(0.5);
    expect(pointerPressure('touch', 0)).toBe(0.5);
    expect(pointerPressure('pen', Number.NaN)).toBe(0.5);
  });

  it('turns simulatePressure on in the perfect-freehand options only for pressure tools', () => {
    const flat = withPressures([0.5, 0.5, 0.5]);
    const varied = withPressures([0.1, 0.9, 0.2, 0.8]);
    expect(strokeOptions('pencil', 4, flat, true).simulatePressure).toBe(true);
    expect(strokeOptions('pencil', 4, varied, true).simulatePressure).toBe(false);
    expect(strokeOptions('pencil', 4, varied, true).thinning).toBe(TOOL_PRESETS.pencil.thinning);
    expect(strokeOptions('highlighter', 20, varied, true)).toMatchObject({ simulatePressure: false, thinning: 0 });
  });
});

describe('pointer samples', () => {
  it('uses coalesced events when available', () => {
    const e = new PointerEvent('pointermove', { pointerType: 'pen', clientX: 30 });
    const coalesced = [10, 20, 30].map((x) => new PointerEvent('pointermove', { pointerType: 'pen', clientX: x }));
    Object.defineProperty(e, 'getCoalescedEvents', { value: () => coalesced });
    expect(pointerSamples(e).map((s) => s.clientX)).toEqual([10, 20, 30]);
  });

  it('falls back to the event itself (missing API, empty list or throwing engine)', () => {
    const plain = new PointerEvent('pointermove', { clientX: 7 });
    Object.defineProperty(plain, 'getCoalescedEvents', { value: undefined });
    expect(pointerSamples(plain)).toEqual([plain]);
    const empty = new PointerEvent('pointermove', { clientX: 8 });
    Object.defineProperty(empty, 'getCoalescedEvents', { value: () => [] });
    expect(pointerSamples(empty)).toEqual([empty]);
    const throwing = new PointerEvent('pointermove', { clientX: 9 });
    Object.defineProperty(throwing, 'getCoalescedEvents', {
      value: () => {
        throw new Error('untrusted');
      },
    });
    expect(pointerSamples(throwing)).toEqual([throwing]);
  });
});

describe('StrokeBuilder and smoothing', () => {
  it('merges points closer than the minimum distance, keeping the highest pressure', () => {
    const builder = new StrokeBuilder(1);
    expect(builder.add(0, 0, 0.2)).toBe(true);
    expect(builder.add(0.3, 0.2, 0.6)).toBe(false);
    expect(builder.add(5, 0, 0.4)).toBe(true);
    expect(builder.add(Number.NaN, 0, 0.4)).toBe(false);
    expect(builder.points).toEqual([{ x: 0, y: 0, p: 0.6 }, { x: 5, y: 0, p: 0.4 }]);
  });

  it('smooths jitter and keeps the endpoints', () => {
    const zigzag: InkPoint[] = [0, 1, 2, 3, 4, 5].map((i) => ({ x: i * 10, y: i % 2 === 0 ? 0 : 3, p: 0.5 }));
    const smooth = smoothPoints(zigzag);
    expect(smooth[0]).toEqual(zigzag[0]);
    expect(smooth[5]).toEqual(zigzag[5]);
    for (let i = 1; i < 5; i++) expect(smooth[i]!.y).toBeGreaterThan(0.5);
    for (let i = 1; i < 5; i++) expect(smooth[i]!.y).toBeLessThan(2.5);
  });

  it('finalizes within the schema point limit', () => {
    const huge: InkPoint[] = [];
    for (let i = 0; i < MAX_STROKE_POINTS + 5000; i++) huge.push({ x: i * 0.7, y: Math.sin(i / 3) * 40, p: 0.5 });
    expect(finalizeStrokePoints(huge).length).toBeLessThanOrEqual(MAX_STROKE_POINTS);
  });
});

describe('SVG paths', () => {
  const stroke: InkPoint[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ x: i * 6, y: Math.sin(i) * 5, p: 0.3 + i * 0.05 }));

  it('produces a closed path for strokes and single dots', () => {
    expect(strokePath(stroke, 'pencil', 4)).toMatch(/^M[-\d.]+,[-\d.]+ Q.* Z$/);
    expect(strokePath([{ x: 10, y: 10, p: 0.5 }], 'pen', 4)).toMatch(/^M.*Z$/);
    expect(strokePath([], 'pen', 4)).toBe('');
  });

  it('ignores pressure for the highlighter (constant width)', () => {
    const light = stroke.map((p) => ({ ...p, p: 0.1 }));
    const strong = stroke.map((p) => ({ ...p, p: 0.9 }));
    expect(strokePath(light, 'highlighter', 20)).toBe(strokePath(strong, 'highlighter', 20));
    expect(strokePath(light, 'pencil', 4)).not.toBe(strokePath(strong, 'pencil', 4));
  });
});

describe('tool presets', () => {
  it('uses the contract palettes and widths', () => {
    expect(INK_PALETTE).toEqual(['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#9333ea']);
    expect(HIGHLIGHTER_PALETTE).toEqual(['#fde047', '#86efac', '#93c5fd', '#f9a8d4']);
    expect(thicknessEm('pencil', 'fin')).toBe(0.08);
    expect(thicknessEm('pen', 'epais')).toBe(0.16);
    expect(thicknessEm('highlighter', 'moyen')).toBe(1);
    expect(strokeWidthPx('highlighter', 'epais', 20)).toBeCloseTo(26);
    expect(isInPalette('highlighter', '#FDE047')).toBe(true);
    expect(isInPalette('pen', '#fde047')).toBe(false);
  });

  it('makes the highlighter wide, transparent and multiplied; the pen precise; the pencil pressure-sensitive', () => {
    expect(TOOL_PRESETS.highlighter).toMatchObject({ blendMode: 'multiply', usesPressure: false });
    expect(TOOL_PRESETS.highlighter.opacity).toBeLessThan(0.6);
    expect(TOOL_PRESETS.pen.thinning).toBeLessThan(TOOL_PRESETS.pencil.thinning);
    expect(TOOL_PRESETS.pencil.usesPressure).toBe(true);
  });
});
