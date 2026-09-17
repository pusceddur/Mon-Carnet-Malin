import { DEFAULT_READING_PREFERENCES, PREFERENCE_RANGES, type ReadingFont, type ReadingPreferences, type ReadingTheme } from '@aide/shared';
import type { CSSProperties } from 'react';

export const READING_FONTS: readonly ReadingFont[] = ['lexend', 'andika', 'atkinson', 'opendyslexic', 'systeme'];
export const READING_THEMES: readonly ReadingTheme[] = ['creme', 'clair', 'sombre'];

/** Paper colour of each theme (for `<meta name="theme-color">`). Mirrors tokens.css. */
export const THEME_PAPER: Readonly<Record<ReadingTheme, string>> = {
  creme: '#FBF6EC',
  clair: '#FFFFFF',
  sombre: '#1F2023',
};

export type ReadingStylePrefs = Pick<ReadingPreferences, 'fontSizePx' | 'lineHeight' | 'letterSpacingEm' | 'wordSpacingEm' | 'columnWidthEm'>;

type CSSVars = CSSProperties & Record<`--${string}`, string>;

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Class that selects the reading font (`.read-font-*` in global.css). Unknown values fall back to Lexend. */
export function readingFontClass(font: ReadingFont): string {
  return `read-font-${READING_FONTS.includes(font) ? font : 'lexend'}`;
}

/**
 * Inline style with the reading custom properties, clamped to PREFERENCE_RANGES.
 * Combine with the `.reading` class and `readingFontClass(prefs.font)`.
 */
export function readingStyleVars(prefs: ReadingStylePrefs): CSSVars {
  const r = PREFERENCE_RANGES;
  const d = DEFAULT_READING_PREFERENCES;
  const size = clamp(prefs.fontSizePx, r.fontSizePx.min, r.fontSizePx.max, d.fontSizePx);
  const lineHeight = clamp(prefs.lineHeight, r.lineHeight.min, r.lineHeight.max, d.lineHeight);
  const letter = clamp(prefs.letterSpacingEm, r.letterSpacingEm.min, r.letterSpacingEm.max, d.letterSpacingEm);
  const word = clamp(prefs.wordSpacingEm, r.wordSpacingEm.min, r.wordSpacingEm.max, d.wordSpacingEm);
  const column = clamp(prefs.columnWidthEm, r.columnWidthEm.min, r.columnWidthEm.max, d.columnWidthEm);
  return {
    '--read-size': `${round(size, 1)}px`,
    '--read-line-height': String(round(lineHeight, 2)),
    '--read-letter-spacing': `${round(letter, 3)}em`,
    '--read-word-spacing': `${round(word, 3)}em`,
    '--read-column': `${round(column, 1)}em`,
  };
}

/**
 * Applies a theme to an element (default: `<html>`). `null` removes the attribute so the system preference applies.
 * When applied to `<html>`, the browser chrome colour follows the paper colour.
 */
export function applyTheme(theme: ReadingTheme | null, root: HTMLElement = document.documentElement): void {
  if (theme && READING_THEMES.includes(theme)) root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  if (root !== root.ownerDocument.documentElement) return;
  const meta = root.ownerDocument.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  const prefersDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  meta.content = THEME_PAPER[theme ?? (prefersDark ? 'sombre' : 'creme')];
}
