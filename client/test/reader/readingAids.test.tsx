import { DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES } from '@aide/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { applyReadingProfile, matchReadingProfile, READING_PROFILES } from '../../src/features/parent/readingProfiles';
import { hasReadingAids, readingAidClasses, readingAidsOf } from '../../src/features/reader/aids';
import { buildBlockModel } from '../../src/features/reader/model';
import { ReaderBlock } from '../../src/features/reader/ReaderBlock';
import { cleanup, render } from '../design/render';

describe('couleurs de lecture in the reader (§26)', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('marks the letters inside each word, keeps every word and its offset, and draws the liaison under the space', async () => {
    const block = buildBlockModel(0, 0, { kind: 'paragraph', text: 'Les amis mangent.' }, 'h');
    const { container } = await render(<ReaderBlock block={block} coded />);
    const words = Array.from(container.querySelectorAll('.rp-w'));
    expect(words.map((w) => [w.textContent, w.getAttribute('data-o')])).toEqual([['Les', '0'], ['amis', '4'], ['mangent', '9']]);
    expect(container.textContent).toBe('Les amis mangent.');
    // les‿amis: the s of « les » is silent, the liaison is on the space.
    expect(container.querySelector('.rp-li')?.textContent).toBe(' ');
    expect(Array.from(words[0]?.querySelectorAll('.rp-mu') ?? []).map((s) => s.textContent)).toEqual(['s']);
    // a|mis: two syllables, the s is silent.
    const amis = Array.from(words[1]?.children ?? []).map((s) => [s.textContent, s.className]);
    expect(amis).toEqual([['a', 'rp-y0'], ['mi', 'rp-y1'], ['s', 'rp-y1 rp-mu']]);
    // man|gent: « an » one sound, g soft, « ent » silent.
    const mangent = Array.from(words[2]?.children ?? []).map((s) => [s.textContent, s.className]);
    expect(mangent).toEqual([['m', 'rp-y0'], ['an', 'rp-y0 rp-so'], ['g', 'rp-y1 rp-cg'], ['ent', 'rp-y1 rp-mu']]);
  });

  it('draws the plain text when no aid is on', async () => {
    const block = buildBlockModel(0, 0, { kind: 'paragraph', text: 'Les amis.' }, 'h');
    const { container } = await render(<ReaderBlock block={block} />);
    expect(container.querySelectorAll('.rp-w span, .rp-li')).toHaveLength(0);
  });

  it('turns each aid into a class of the reader; profiles saved before §26 have none', () => {
    expect(readingAidsOf({})).toEqual(DEFAULT_READING_PREFERENCES.aids);
    expect(hasReadingAids(readingAidsOf({}))).toBe(false);
    const aids = { ...DEFAULT_READING_PREFERENCES.aids, syllables: true, liaisons: true };
    expect(readingAidClasses(aids)).toEqual(['rp-aid-syl', 'rp-aid-liaison']);
  });
});

describe('profils de lecture (§27)', () => {
  it('recognizes the settings of a new profile, applies a profile in one go and shows adjusted settings as custom', () => {
    expect(matchReadingProfile(DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES)).toBe('confort');
    for (const profile of READING_PROFILES) {
      const applied = applyReadingProfile({ reading: { ...DEFAULT_READING_PREFERENCES, theme: 'sombre' }, tts: DEFAULT_TTS_PREFERENCES }, profile);
      expect(matchReadingProfile(applied.reading, applied.tts)).toBe(profile.id);
      // The paper colour is a matter of taste: kept.
      expect(applied.reading.theme).toBe('sombre');
    }
    const couleurs = READING_PROFILES.find((p) => p.id === 'couleurs');
    if (!couleurs) throw new Error('missing profile');
    const applied = applyReadingProfile({ reading: DEFAULT_READING_PREFERENCES, tts: DEFAULT_TTS_PREFERENCES }, couleurs);
    expect(applied.reading.aids).toMatchObject({ syllables: true, silentLetters: true, sounds: true, liaisons: true });
    expect(matchReadingProfile({ ...applied.reading, fontSizePx: 40 }, applied.tts)).toBeNull();
    expect(matchReadingProfile({ ...applied.reading, aids: { ...applied.reading.aids, liaisons: false } }, applied.tts)).toBeNull();
  });
});
