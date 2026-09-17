/** Distance (px) after which releasing a downward drag closes the sheet, whatever the speed. */
export const SWIPE_CLOSE_DISTANCE = 120;
/** Minimum distance for a fast flick to close. */
export const SWIPE_FLICK_MIN_DISTANCE = 32;
/** Flick speed (px/ms) that closes the sheet. */
export const SWIPE_FLICK_VELOCITY = 0.6;

/**
 * Decides whether a downward drag of `deltaY` px lasting `durationMs` should dismiss a sheet of `sheetHeight` px.
 * Short sheets close after a quarter of their height.
 */
export function shouldDismissSwipe(deltaY: number, durationMs: number, sheetHeight: number): boolean {
  if (!Number.isFinite(deltaY) || deltaY <= 0) return false;
  const distance = sheetHeight > 0 ? Math.min(SWIPE_CLOSE_DISTANCE, sheetHeight * 0.25) : SWIPE_CLOSE_DISTANCE;
  if (deltaY >= distance) return true;
  const velocity = deltaY / Math.max(1, durationMs);
  return deltaY >= SWIPE_FLICK_MIN_DISTANCE && velocity >= SWIPE_FLICK_VELOCITY;
}

/** Drag offset applied to the sheet: downward only. */
export function sheetDragOffset(deltaY: number): number {
  if (!Number.isFinite(deltaY)) return 0;
  return deltaY >= 0 ? deltaY : 0;
}
