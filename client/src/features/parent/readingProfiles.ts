// §27 Profils de lecture: ready-made reading settings, chosen in one tap on the child profile and named after what they do,
// never after a diagnosis. Every value stays adjustable one by one in « Réglages avancés »; a profile whose values were
// changed shows as « Personnalisé ». The colour of the paper and the page / continuous layout are a matter of taste and are
// never changed by a profile.
import type { ReadingAids, ReadingFont, ReadingPreferences, TTSPreferences } from '@aide/shared';
import { readingAidsOf } from '../reader/aids';

export type ReadingProfileId = 'confort' | 'couleurs' | 'grandes_lettres' | 'apprenti' | 'concentration';

type ProfileReading = Pick<ReadingPreferences, 'fontSizePx' | 'lineHeight' | 'letterSpacingEm' | 'wordSpacingEm' | 'columnWidthEm'
  | 'sentenceHighlight' | 'readingGuide'> & { font: ReadingFont; aids: ReadingAids };

export interface ReadingProfile { id: ReadingProfileId; emoji: string; reading: ProfileReading; tts: Pick<TTSPreferences, 'rate'> }

const NO_AIDS: ReadingAids = { syllables: false, silentLetters: false, sounds: false, changedLetters: false, liaisons: false };
const ALL_AIDS: ReadingAids = { syllables: true, silentLetters: true, sounds: true, changedLetters: true, liaisons: true };

export const READING_PROFILES: readonly ReadingProfile[] = [
  {
    // The settings of a new profile (DEFAULT_READING_PREFERENCES).
    id: 'confort',
    emoji: '📖',
    reading: {
      font: 'lexend', fontSizePx: 24, lineHeight: 1.8, letterSpacingEm: 0.04, wordSpacingEm: 0.16, columnWidthEm: 30,
      sentenceHighlight: true, readingGuide: false, aids: NO_AIDS,
    },
    tts: { rate: 0.85 },
  },
  {
    // Decoding: syllables, silent letters, sounds and liaisons marked; more space between letters, words and lines.
    id: 'couleurs',
    emoji: '🌈',
    reading: {
      font: 'lexend', fontSizePx: 26, lineHeight: 2, letterSpacingEm: 0.08, wordSpacingEm: 0.3, columnWidthEm: 28,
      sentenceHighlight: true, readingGuide: false, aids: { ...ALL_AIDS, changedLetters: false },
    },
    tts: { rate: 0.8 },
  },
  {
    // Letters that move or crowd: a font made to tell letters apart, large and widely spaced, short lines, reading ruler.
    id: 'grandes_lettres',
    emoji: '🔍',
    reading: {
      font: 'atkinson', fontSizePx: 28, lineHeight: 2.2, letterSpacingEm: 0.12, wordSpacingEm: 0.4, columnWidthEm: 24,
      sentenceHighlight: true, readingGuide: true, aids: { ...NO_AIDS, syllables: true, silentLetters: true },
    },
    tts: { rate: 0.85 },
  },
  {
    // CP–CE1: the font of beginning readers, very large, every couleur de lecture, slow voice.
    id: 'apprenti',
    emoji: '🌱',
    reading: {
      font: 'andika', fontSizePx: 30, lineHeight: 2.2, letterSpacingEm: 0.08, wordSpacingEm: 0.36, columnWidthEm: 24,
      sentenceHighlight: true, readingGuide: false, aids: ALL_AIDS,
    },
    tts: { rate: 0.75 },
  },
  {
    // Short lines and the ruler keep the eyes on the line; no colours on the letters (less to look at).
    id: 'concentration',
    emoji: '🎯',
    reading: {
      font: 'lexend', fontSizePx: 26, lineHeight: 2, letterSpacingEm: 0.06, wordSpacingEm: 0.24, columnWidthEm: 26,
      sentenceHighlight: true, readingGuide: true, aids: NO_AIDS,
    },
    tts: { rate: 0.9 },
  },
];

export function applyReadingProfile(
  values: { reading: ReadingPreferences; tts: TTSPreferences }, profile: ReadingProfile,
): { reading: ReadingPreferences; tts: TTSPreferences } {
  return { reading: { ...values.reading, ...profile.reading, aids: { ...profile.reading.aids } }, tts: { ...values.tts, ...profile.tts } };
}

const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/** The profile whose values these are, null when they were adjusted (« Personnalisé »). */
export function matchReadingProfile(reading: ReadingPreferences, tts: TTSPreferences): ReadingProfileId | null {
  const aids = readingAidsOf(reading);
  const found = READING_PROFILES.find(({ reading: p, tts: v }) =>
    reading.font === p.font && same(reading.fontSizePx, p.fontSizePx) && same(reading.lineHeight, p.lineHeight)
    && same(reading.letterSpacingEm, p.letterSpacingEm) && same(reading.wordSpacingEm, p.wordSpacingEm)
    && same(reading.columnWidthEm, p.columnWidthEm) && reading.sentenceHighlight === p.sentenceHighlight
    && reading.readingGuide === p.readingGuide && same(tts.rate, v.rate)
    && (Object.keys(p.aids) as (keyof ReadingAids)[]).every((key) => aids[key] === p.aids[key]));
  return found?.id ?? null;
}
