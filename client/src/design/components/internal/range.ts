function decimalsOf(step: number): number {
  if (!Number.isFinite(step)) return 0;
  const text = String(step);
  const exp = /e-(\d+)$/.exec(text);
  if (exp) return Number(exp[1]);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** Clamps to [min, max] and snaps to the step grid anchored at `min`, without floating point noise (0.1 + 0.2). */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!Number.isFinite(value)) return lo;
  const clamped = Math.min(hi, Math.max(lo, value));
  if (!(step > 0)) return clamped;
  const decimals = Math.max(decimalsOf(step), decimalsOf(lo));
  const snapped = lo + Math.round((clamped - lo) / step) * step;
  const bounded = Math.min(hi, Math.max(lo, snapped));
  return Number(bounded.toFixed(decimals));
}

/** Position of `value` on the track, 0..1. */
export function rangeFraction(value: number, min: number, max: number): number {
  if (!(max > min) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/**
 * Value under a pointer at `clientX` on a track starting at `left` and `width` px wide.
 * The thumb centre travels between thumbSize/2 and width - thumbSize/2 (like a native range input).
 */
export function valueFromPointer(
  clientX: number,
  left: number,
  width: number,
  min: number,
  max: number,
  step: number,
  thumbSize = 0,
): number {
  const usable = Math.max(1, width - thumbSize);
  const fraction = Math.min(1, Math.max(0, (clientX - left - thumbSize / 2) / usable));
  return snapToStep(min + fraction * (max - min), min, max, step);
}
