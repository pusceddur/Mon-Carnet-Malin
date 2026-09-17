import { describe, expect, it } from 'vitest';
import { normalizeDisplayText, normalizeForMatch } from '../../src/text/normalize';
import { isElisionToken, tokenizeWords } from '../../src/text/tokenize';
import { createWordList } from '../../src/text/wordlist';

const words = (text: string): string[] => tokenizeWords(text).map((t) => t.word);

describe('normalizeForMatch', () => {
  it('lowercases, strips accents and ligatures', () => {
    expect(normalizeForMatch('Élève ÇA Œuf Ægypte')).toBe('eleve ca oeuf aegypte');
    expect(normalizeForMatch('Cœur')).toBe('coeur');
  });

  it('turns punctuation, quotes and dashes into single spaces', () => {
    expect(normalizeForMatch('« Bonjour ! » — dit-il, l’air ravi…')).toBe('bonjour dit il l air ravi');
    expect(normalizeForMatch("l'arbre")).toBe(normalizeForMatch('l’arbre'));
    expect(normalizeForMatch('  a   b\n\nc  ')).toBe('a b c');
  });

  it('applies NFKC (ligatures, superscripts, full-width)', () => {
    expect(normalizeForMatch('ﬁn XIXᵉ')).toBe('fin xixe');
    expect(normalizeForMatch('ＡＢＣ')).toBe('abc');
  });

  it('keeps digits', () => {
    expect(normalizeForMatch('En 1789, 3,5 %')).toBe('en 1789 3 5');
  });

  it('is idempotent', () => {
    const once = normalizeForMatch('Où est passé le « chat » ?');
    expect(normalizeForMatch(once)).toBe(once);
  });
});

describe('normalizeDisplayText', () => {
  it('collapses spaces but keeps French no-break spaces', () => {
    expect(normalizeDisplayText('Bonjour   le\tmonde')).toBe('Bonjour le monde');
    expect(normalizeDisplayText('Quoi ?')).toBe('Quoi ?');
    expect(normalizeDisplayText('Quoi   ?')).toBe('Quoi ?');
  });

  it('removes soft hyphens, zero-width spaces and control characters', () => {
    expect(normalizeDisplayText('pho­to​synthèse')).toBe('photosynthèse');
  });

  it('normalizes to NFC and keeps paragraphs', () => {
    expect(normalizeDisplayText('été')).toBe('été');
    expect(normalizeDisplayText('Un.  \r\n\r\n\r\n  Deux.')).toBe('Un.\n\nDeux.');
  });
});

describe('tokenizeWords', () => {
  it('returns offsets matching the text', () => {
    const text = 'Le chat dort.';
    for (const t of tokenizeWords(text)) expect(text.slice(t.start, t.end)).toBe(t.word);
    expect(words(text)).toEqual(['Le', 'chat', 'dort']);
  });

  it('splits elisions with both apostrophes, keeping the apostrophe on the clitic', () => {
    expect(words('l’arbre')).toEqual(['l’', 'arbre']);
    expect(words("l'arbre")).toEqual(["l'", 'arbre']);
    expect(words('Qu’est-ce que c’est ?')).toEqual(['Qu’', 'est-ce', 'que', 'c’', 'est']);
    expect(words("jusqu'à l'école")).toEqual(["jusqu'", 'à', "l'", 'école']);
    expect(isElisionToken('l’')).toBe(true);
    expect(isElisionToken('arbre')).toBe(false);
  });

  it('keeps lexical apostrophes', () => {
    expect(words('aujourd’hui et quelqu’un')).toEqual(['aujourd’hui', 'et', 'quelqu’un']);
  });

  it('keeps inner hyphens but not outer ones', () => {
    expect(words('un arc-en-ciel')).toEqual(['un', 'arc-en-ciel']);
    expect(words('Viendra-t-il ?')).toEqual(['Viendra-t-il']);
    expect(words('- Oui - non -')).toEqual(['Oui', 'non']);
  });

  it('handles digits, decimals and ordinals', () => {
    expect(words('En 1789, 3,5 kg et 2.5 m au XIXe siècle et le 1er mai')).toEqual(
      ['En', '1789', '3,5', 'kg', 'et', '2.5', 'm', 'au', 'XIXe', 'siècle', 'et', 'le', '1er', 'mai'],
    );
    expect(words('Fin.')).toEqual(['Fin']);
  });

  it('handles accents, combining marks and ligatures', () => {
    expect(words('Œdipe mange un œuf à côté')).toEqual(['Œdipe', 'mange', 'un', 'œuf', 'à', 'côté']);
    expect(words('été')).toEqual(['été']);
  });

  it('returns nothing for punctuation only', () => {
    expect(tokenizeWords(' … « » — ! ')).toEqual([]);
  });
});

describe('createWordList', () => {
  it('stores normalized words', () => {
    const list = createWordList(['Été', 'forêt', 'forêt', '', 'Arc-en-ciel']);
    expect(list.size).toBe(3);
    expect(list.has('ete')).toBe(true);
    expect(list.has('foret')).toBe(true);
    expect(list.has('arc en ciel')).toBe(true);
    expect(list.has('Été')).toBe(false);
  });
});
