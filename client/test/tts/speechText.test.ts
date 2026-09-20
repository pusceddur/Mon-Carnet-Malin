import { describe, expect, it } from 'vitest';
import { frenchCardinal, frenchOrdinal, prepareSpokenText, preparedSpokenText, romanToInt } from '../../src/tts/speechText';

describe('French numbers in words', () => {
  it('says cardinals with French rules', () => {
    expect([1, 16, 17, 21, 22, 31, 70, 71, 72, 80, 81, 91, 99, 100, 200, 201, 999].map(frenchCardinal)).toEqual([
      'un', 'seize', 'dix-sept', 'vingt et un', 'vingt-deux', 'trente et un', 'soixante-dix', 'soixante et onze', 'soixante-douze',
      'quatre-vingts', 'quatre-vingt-un', 'quatre-vingt-onze', 'quatre-vingt-dix-neuf', 'cent', 'deux cents', 'deux cent un',
      'neuf cent quatre-vingt-dix-neuf',
    ]);
  });

  it('says ordinals', () => {
    expect(frenchOrdinal(1)).toBe('premier');
    expect(frenchOrdinal(1, true)).toBe('première');
    expect(frenchOrdinal(2)).toBe('deuxième');
    expect(frenchOrdinal(5)).toBe('cinquième');
    expect(frenchOrdinal(9)).toBe('neuvième');
    expect(frenchOrdinal(19)).toBe('dix-neuvième');
    expect(frenchOrdinal(21)).toBe('vingt et unième');
    expect(frenchOrdinal(80)).toBe('quatre-vingtième');
  });

  it('reads roman numerals strictly', () => {
    expect(romanToInt('XIX')).toBe(19);
    expect(romanToInt('XIV')).toBe(14);
    expect(romanToInt('IIII')).toBeNull();
    expect(romanToInt('MIX')).toBe(1009);
    expect(romanToInt('ABC')).toBeNull();
  });
});

describe('prepareSpokenText', () => {
  const spoken = (s: string): string => prepareSpokenText(s).text;

  it('says centuries, kings and chapters in words', () => {
    expect(spoken('Au XIXe siècle, les trains roulaient vite.')).toBe('Au dix-neuvième siècle, les trains roulaient vite.');
    expect(spoken('François Ier et Louis XIV étaient rois.')).toBe('François premier et Louis quatorze étaient rois.');
    expect(spoken('Lis le chapitre III.')).toBe('Lis le chapitre trois.');
    expect(spoken('en 52 av. J.-C.')).toBe('en 52 avant Jésus-Christ');
  });

  it('expands common abbreviations only where they are abbreviations', () => {
    expect(spoken('M. Dupont et Mme Martin arrivent.')).toBe('Monsieur Dupont et Madame Martin arrivent.');
    expect(spoken('Il habite à St Malo, voir p. 12 et le n° 4.')).toBe('Il habite à Saint Malo, voir page 12 et le numéro 4.');
    expect(spoken('Des fruits, des légumes, etc.')).toBe('Des fruits, des légumes, et cetera');
    // « M. » at the end of a sentence is not « Monsieur ».
    expect(spoken('Il mesure 3 M.')).toBe('Il mesure 3 M.');
  });

  it('removes OCR noise and silent quote marks, keeps a breath for dialogue dashes', () => {
    expect(spoken('« Bonjour », dit | Léo •')).toBe('Bonjour , dit Léo');
    expect(spoken('— Viens ici, dit-elle.')).toBe('Viens ici, dit-elle.');
    expect(spoken('Il ouvrit la porte – et sortit.')).toBe('Il ouvrit la porte , et sortit.');
    expect(spoken('pho­to   graphie​')).toBe('photo graphie');
  });

  it('maps every spoken position back to the displayed text (word highlighting)', () => {
    const source = 'Au XIXe siècle, M. Dupont lisait.';
    const s = prepareSpokenText(source);
    const at = (word: string): number => s.toSource(s.text.indexOf(word));
    expect(source.slice(at('siècle'), at('siècle') + 6)).toBe('siècle');
    expect(source.slice(at('Dupont'), at('Dupont') + 6)).toBe('Dupont');
    // Inside a replacement, positions point at the start of the original token.
    expect(source.slice(at('neuvième'), at('neuvième') + 4)).toBe('XIXe');
    expect(source.slice(at('Monsieur'), at('Monsieur') + 2)).toBe('M.');
    expect(s.toSource(10_000)).toBeLessThan(source.length);
  });

  it('does not take French words for roman numerals', () => {
    for (const text of ['Le chat dort.', 'Ce matin, De Gaulle parla.', 'Me voici. Mi-temps.', 'Vive la Ve République !', 'CE2 et CM1', 'Il vit à Dijon.']) {
      const out = spoken(text);
      expect(out).not.toMatch(/cinquantième|centième|cinq-centième|millième|cinq cent/);
    }
    expect(spoken('Vive la Ve République !')).toBe('Vive la cinquième République !');
    expect(spoken('Le Xe siècle')).toBe('Le dixième siècle');
  });

  it('leaves normal text unchanged', () => {
    const text = 'La plante puise l’eau du sol grâce à ses racines.';
    expect(spoken(text)).toBe(text);
  });
});

describe('§22 lists and « Préparer la lecture »', () => {
  it('reads a list marker with a pause', () => {
    expect(prepareSpokenText("1: lis l'article").text).toBe("1. lis l'article");
    expect(prepareSpokenText('2) souligne les verbes').text).toBe('2. souligne les verbes');
    expect(prepareSpokenText('b) le chien').text).toBe('b. le chien');
    // Already right, and titles keep their words.
    expect(prepareSpokenText('3. Relis ton texte.').text).toBe('3. Relis ton texte.');
    expect(prepareSpokenText('M. Dupont arrive.').text).toBe('Monsieur Dupont arrive.');
    // Not at the start of what is read: left alone.
    expect(prepareSpokenText('Il est 10: 30.').text).toBe('Il est 10: 30.');
  });

  it('reads the prepared text and maps every word back onto the displayed one', () => {
    const display = "1: lis l'article 2: souligne les verbes";
    const prepared = "1. Lis l’article. 2. Souligne les verbes.";
    const spoken = preparedSpokenText(display, prepared);
    expect(spoken?.text).toBe(prepared);
    for (const word of ['Lis', 'l’article', 'Souligne', 'verbes']) {
      const source = spoken!.toSource(prepared.indexOf(word));
      expect(display.slice(source).toLowerCase().replace('’', "'")).toMatch(new RegExp(`^${word.toLowerCase().replace('’', "'")}`));
    }
    // Punctuation added by the preparation maps to the end of the word before it.
    expect(spoken!.toSource(prepared.indexOf('.', 5))).toBe(display.indexOf(' 2:'));
  });

  it('still applies the usual rules to the prepared text', () => {
    expect(preparedSpokenText('M. Dupont lit au XIXe siècle', 'M. Dupont lit, au XIXe siècle.')?.text).toBe('Monsieur Dupont lit, au dix-neuvième siècle.');
  });

  it('refuses a preparation whose words differ', () => {
    expect(preparedSpokenText('Le chat dort', 'Le chat dort bien.')).toBeNull();
    expect(preparedSpokenText('Le chat dort', 'Le chien dort.')).toBeNull();
    expect(preparedSpokenText('', '')).toBeNull();
  });
});
