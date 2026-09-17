import { describe, expect, it } from 'vitest';
import { checkAge } from '../../src/safety/AgeGuard';
import { checkLengthRules, checkSimplifyLength } from '../../src/safety/LengthGuard';
import { checkEntities, checkEntitiesPreserved, checkQuote, EntitySource } from '../../src/safety/SourceGuard';
import { SourceIndex } from '../../src/safety/textMatch';
import { isKnownWord } from '../ai/helpers';

describe('SourceGuard quotes', () => {
  const index = new SourceIndex([
    { pageIndex: 2, text: 'La Seine traverse Paris. Elle se jette dans la Manche au Havre.' },
    { pageIndex: 3, text: "Le Rhône prend sa source dans les Alpes, en Suisse, et se jette dans la mer Méditerranée." },
  ]);

  it('finds exact quotes whatever the typography and resolves the page', () => {
    expect(checkQuote(index, 'le rhone prend sa source dans les ALPES', 'q').match).toMatchObject({ found: true, pageIndex: 3, exact: true });
    expect(checkQuote(index, 'La Seine traverse Paris.', 'q').match.pageIndex).toBe(2);
  });

  it('tolerates an OCR error (Jaccard ≥ 0.85) but not a different sentence', () => {
    const ocr = new SourceIndex([{ pageIndex: 0, text: 'Le Rhône prend sa sourcc dans les Alpes en Suisse et se jette dans la mer Méditerranée.' }]);
    expect(checkQuote(ocr, 'Le Rhône prend sa source dans les Alpes, en Suisse, et se jette dans la mer Méditerranée.', 'q').issues).toEqual([]);
    expect(checkQuote(index, 'La Loire est le plus long fleuve de France.', 'q').issues.map((i) => i.code)).toEqual(['source_quote_not_found']);
    expect(checkQuote(index, '  ', 'q').issues.map((i) => i.code)).toEqual(['source_quote_empty']);
  });
});

describe('SourceGuard entities', () => {
  const source = new EntitySource([{ pageIndex: 0, text: 'En 1789, les Parisiens prennent la Bastille. Trois jours plus tard, le roi Louis XVI se rend à Paris.' }], isKnownWord);

  it('accepts entities of the source, including numbers written in letters', () => {
    expect(checkEntities(['Le 14 juillet 1789, la Bastille est prise.'], source, 'strict')).toMatchObject([{ code: 'source_invented_number' }]);
    expect(checkEntities(['En 1789, les Parisiens prennent la Bastille. 3 jours après, Louis XVI va à Paris.'], source, 'strict')).toEqual([]);
  });

  it('rejects invented years, numbers and names in strict mode', () => {
    const codes = checkEntities(['En 1792, Napoléon arrive avec 500 soldats.'], source, 'strict').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['source_invented_year', 'source_invented_name', 'source_invented_number']));
  });

  it('lenient mode (explanations) allows small numbers but not years or names', () => {
    expect(checkEntities(['Une semaine dure 7 jours.'], source, 'lenient')).toEqual([]);
    const codes = checkEntities(['Cela arrive aussi en 1850 avec Napoléon.'], source, 'lenient').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['source_invented_year', 'source_invented_name']));
  });

  it('simplification keeps at least 80 % of the entities', () => {
    expect(checkEntitiesPreserved(source, 'En 1789, les Parisiens prennent la Bastille. Trois jours après, le roi Louis XVI va à Paris.')).toEqual([]);
    expect(checkEntitiesPreserved(source, 'Le peuple prend une prison. Le roi va en ville.').map((i) => i.code)).toEqual(['source_entities_lost']);
  });
});

describe('AgeGuard', () => {
  const sentence = (n: number): string => `${Array.from({ length: n }, (_, i) => ['le', 'chat', 'mange', 'une', 'souris'][i % 5]).join(' ').replace(/^l/, 'L')}.`;

  it('only checks the longest sentence under 30 words', () => {
    expect(checkAge({ texts: [sentence(20)], difficulty: 'tres_simple', exemptWords: [], attempt: 1 }).ok).toBe(true);
    expect(checkAge({ texts: [sentence(23)], difficulty: 'tres_simple', exemptWords: [], attempt: 1 }).issues.map((i) => i.code)).toEqual(['age_sentence_too_long']);
  });

  it('uses the thresholds of the explanation difficulty', () => {
    const text = [sentence(16), sentence(16), sentence(16)];
    expect(checkAge({ texts: text, difficulty: 'tres_simple', exemptWords: [], attempt: 1 }).ok).toBe(false);
    expect(checkAge({ texts: text, difficulty: 'simple', exemptWords: [], attempt: 1 }).ok).toBe(true);
  });

  it('exempts source words from the long-word ratio', () => {
    const words = 'photosynthèse chlorophylle évaporation';
    const text = Array.from({ length: 6 }, () => `La ${words} existe.`).join(' ');
    expect(checkAge({ texts: [text], difficulty: 'simple', exemptWords: [], attempt: 1 }).issues.map((i) => i.code)).toContain('age_long_words');
    expect(checkAge({ texts: [text], difficulty: 'simple', exemptWords: words.split(' '), attempt: 1 }).ok).toBe(true);
  });
});

describe('LengthGuard', () => {
  it('limits words per field', () => {
    expect(checkLengthRules([{ field: 'answer', text: 'un deux trois', maxWords: 3 }]).ok).toBe(true);
    expect(checkLengthRules([{ field: 'answer', text: 'un deux trois quatre', maxWords: 3 }]).issues[0]).toMatchObject({ code: 'length_exceeded', detail: 'answer:4>3' });
  });

  it('bounds simplifications to [0.3 ×, max(1.5 ×, source + 12)]', () => {
    const source = Array.from({ length: 10 }, (_, i) => `mot${i}`).join(' ');
    expect(checkSimplifyLength(source, 'un deux').ok).toBe(false);
    expect(checkSimplifyLength(source, Array.from({ length: 22 }, () => 'mot').join(' ')).ok).toBe(true);
    expect(checkSimplifyLength(source, Array.from({ length: 23 }, () => 'mot').join(' ')).ok).toBe(false);
  });
});
