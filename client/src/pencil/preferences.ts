// Per-device persistence of the tool choices (kv `pencilPreferences`): colours, thickness, eraser mode, finger drawing.
import type { EraserMode, InkTool, Thickness } from '@aide/shared';
import { db } from '../db/localDb';
import { usePencilStore, type PencilStore } from './store';
import { ERASER_MODES, INK_TOOLS, THICKNESSES, isInPalette } from './Tools';

export const PENCIL_PREFERENCES_KEY = 'pencilPreferences';
const SAVE_DELAY_MS = 300;

export interface PencilPreferences {
  colorByTool: Record<InkTool, string>;
  thicknessByTool: Record<InkTool, Thickness>;
  eraserMode: EraserMode;
  fingerDraws: boolean;
  penDetected: boolean;
}

type Persisted = Pick<PencilStore, keyof PencilPreferences>;

function pick(s: Persisted): PencilPreferences {
  return { colorByTool: { ...s.colorByTool }, thicknessByTool: { ...s.thicknessByTool }, eraserMode: s.eraserMode, fingerDraws: s.fingerDraws, penDetected: s.penDetected };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Keeps only valid values from a stored record (unknown or outdated data is ignored field by field). */
export function sanitizePreferences(value: unknown, fallback: PencilPreferences): PencilPreferences {
  if (!isRecord(value)) return fallback;
  const out = pick(fallback);
  const colors = value.colorByTool;
  const thicknesses = value.thicknessByTool;
  for (const tool of INK_TOOLS) {
    const color = isRecord(colors) ? colors[tool] : undefined;
    if (typeof color === 'string' && isInPalette(tool, color)) out.colorByTool[tool] = color.toLowerCase();
    const thickness = isRecord(thicknesses) ? thicknesses[tool] : undefined;
    if (typeof thickness === 'string' && (THICKNESSES as readonly string[]).includes(thickness)) out.thicknessByTool[tool] = thickness as Thickness;
  }
  if (typeof value.eraserMode === 'string' && (ERASER_MODES as readonly string[]).includes(value.eraserMode) && value.eraserMode !== 'page') {
    out.eraserMode = value.eraserMode as EraserMode;
  }
  if (typeof value.fingerDraws === 'boolean') out.fingerDraws = value.fingerDraws;
  if (typeof value.penDetected === 'boolean') out.penDetected = value.penDetected;
  return out;
}

let started: Promise<void> | null = null;

/** Loads the stored preferences once, then saves every change (debounced). Idempotent, never throws. */
export function startPencilPreferences(): Promise<void> {
  if (started) return started;
  started = (async () => {
    try {
      const record = await db.kv.get(PENCIL_PREFERENCES_KEY);
      const state = usePencilStore.getState();
      const prefs = sanitizePreferences(record?.value, pick(state));
      const tool = state.tool === 'eraser' ? state.lastInkTool : state.tool;
      usePencilStore.setState({ ...prefs, color: prefs.colorByTool[tool], thickness: prefs.thicknessByTool[tool] });
    } catch {
      // Storage unavailable: defaults stay.
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = JSON.stringify(pick(usePencilStore.getState()));
    usePencilStore.subscribe((state) => {
      const next = JSON.stringify(pick(state));
      if (next === last) return;
      last = next;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        db.kv.put({ key: PENCIL_PREFERENCES_KEY, value: JSON.parse(next) as PencilPreferences }).catch(() => undefined);
      }, SAVE_DELAY_MS);
    });
  })();
  return started;
}
