// Tool presets (pencil, pen, highlighter, eraser): palettes, widths, rendering parameters (contract §11.5).
import { HIGHLIGHTER_COLORS, INK_COLORS, THICKNESS_EM, type EraserMode, type InkTool, type Thickness } from '@aide/shared';
import { pencil as strings } from '../i18n/fr/pencil';

export type ToolId = InkTool | 'eraser';
export type InkSpaceKind = 'text' | 'original' | 'answer';
export type PointerKind = 'pen' | 'touch' | 'mouse';

export const TOOL_ICONS: Readonly<Record<ToolId, string>> = {
  pencil: '✏️',
  pen: '🖊️',
  highlighter: '🖍️',
  eraser: '🧽',
};

export const ACTION_ICONS = { undo: '↩️', redo: '↪️', colors: '🎨', more: '⋯', clear: '🗑️', finger: '☝️', read: '📖' } as const;

export const THICKNESSES: readonly Thickness[] = ['fin', 'moyen', 'epais'];
export const ERASER_MODES: readonly EraserMode[] = ['stroke', 'partial', 'page'];
export const INK_TOOLS: readonly InkTool[] = ['pencil', 'pen', 'highlighter'];

export const INK_PALETTE: readonly string[] = Object.values(INK_COLORS);
export const HIGHLIGHTER_PALETTE: readonly string[] = Object.values(HIGHLIGHTER_COLORS);

/** French name of every palette colour (aria-label of the swatches). */
export const COLOR_LABELS: Readonly<Record<string, string>> = {
  [INK_COLORS.noir]: strings.colors.noir,
  [INK_COLORS.bleu]: strings.colors.bleu,
  [INK_COLORS.rouge]: strings.colors.rouge,
  [INK_COLORS.vert]: strings.colors.vert,
  [INK_COLORS.violet]: strings.colors.violet,
  [HIGHLIGHTER_COLORS.jaune]: strings.colors.jaune,
  [HIGHLIGHTER_COLORS.vert]: strings.colors.vertClair,
  [HIGHLIGHTER_COLORS.bleu]: strings.colors.bleuClair,
  [HIGHLIGHTER_COLORS.rose]: strings.colors.rose,
};

export interface InkToolPreset {
  tool: InkTool;
  palette: readonly string[];
  defaultColor: string;
  /** Stored in InkAnnotation.opacity. */
  opacity: number;
  blendMode: 'normal' | 'multiply';
  /** perfect-freehand parameters. */
  thinning: number;
  smoothing: number;
  streamline: number;
  /** false: constant width, pressure ignored. */
  usesPressure: boolean;
  easing: (t: number) => number;
}

const linear = (t: number): number => t;
// Light touches stay visible with the pencil (natural graphite feel).
const easeOutSine = (t: number): number => Math.sin((t * Math.PI) / 2);

export const TOOL_PRESETS: Readonly<Record<InkTool, InkToolPreset>> = {
  pencil: {
    tool: 'pencil',
    palette: INK_PALETTE,
    defaultColor: INK_COLORS.noir,
    opacity: 0.9,
    blendMode: 'normal',
    thinning: 0.6,
    smoothing: 0.55,
    streamline: 0.4,
    usesPressure: true,
    easing: easeOutSine,
  },
  pen: {
    tool: 'pen',
    palette: INK_PALETTE,
    defaultColor: INK_COLORS.bleu,
    opacity: 1,
    blendMode: 'normal',
    thinning: 0.2,
    smoothing: 0.65,
    streamline: 0.55,
    usesPressure: true,
    easing: linear,
  },
  highlighter: {
    tool: 'highlighter',
    palette: HIGHLIGHTER_PALETTE,
    defaultColor: HIGHLIGHTER_COLORS.jaune,
    opacity: 0.45,
    blendMode: 'multiply',
    thinning: 0,
    smoothing: 0.5,
    streamline: 0.6,
    usesPressure: false,
    easing: linear,
  },
};

/** How many em fit in the width of the page image (original view) and of the answer box: converts em widths. */
export const ORIGINAL_EM_PER_PAGE_WIDTH = 45;
export const ANSWER_EM_PER_BOX_WIDTH = 24;
/** The answer box is twice as wide as tall: y coordinates (fractions of the width) stay within 0..0.5. */
export const ANSWER_BOX_RATIO = 0.5;

/** Eraser radius in em, larger for a finger. */
export const ERASER_RADIUS_EM: Readonly<Record<PointerKind, number>> = { pen: 0.45, mouse: 0.45, touch: 0.8 };

export function paletteFor(tool: InkTool): readonly string[] {
  return TOOL_PRESETS[tool].palette;
}

export function isInPalette(tool: InkTool, color: string): boolean {
  return paletteFor(tool).includes(color.toLowerCase());
}

export function thicknessEm(tool: InkTool, thickness: Thickness): number {
  return THICKNESS_EM[tool][thickness];
}

/** Stroke width in CSS px given the size of one em in the current surface. */
export function strokeWidthPx(tool: InkTool, thickness: Thickness, emPx: number): number {
  return thicknessEm(tool, thickness) * emPx;
}

export function eraserRadiusPx(kind: PointerKind, emPx: number): number {
  return Math.max(8, ERASER_RADIUS_EM[kind] * emPx);
}

/** Pixel size of one em for the non-text surfaces. */
export function emPxForOriginal(pageWidthPx: number): number {
  return pageWidthPx / ORIGINAL_EM_PER_PAGE_WIDTH;
}

export function emPxForAnswer(boxWidthPx: number): number {
  return boxWidthPx / ANSWER_EM_PER_BOX_WIDTH;
}
