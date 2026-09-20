// §26 « Couleurs de lecture »: which marks of codeFrenchText the reader shows (classes on the reader, see reader.css).
import { DEFAULT_READING_AIDS, type ReadingAids } from '@aide/shared';

export const READING_AID_KEYS: readonly (keyof ReadingAids)[] = ['syllables', 'silentLetters', 'sounds', 'changedLetters', 'liaisons'];

const CLASS_OF: Readonly<Record<keyof ReadingAids, string>> = {
  syllables: 'rp-aid-syl',
  silentLetters: 'rp-aid-mute',
  sounds: 'rp-aid-sound',
  changedLetters: 'rp-aid-changed',
  liaisons: 'rp-aid-liaison',
};

/** Profiles saved before §26 have no aids. */
export function readingAidsOf(reading: { aids?: ReadingAids }): ReadingAids {
  return { ...DEFAULT_READING_AIDS, ...reading.aids };
}

export function hasReadingAids(aids: ReadingAids): boolean {
  return READING_AID_KEYS.some((key) => aids[key]);
}

export function readingAidClasses(aids: ReadingAids): string[] {
  return READING_AID_KEYS.filter((key) => aids[key]).map((key) => CLASS_OF[key]);
}
