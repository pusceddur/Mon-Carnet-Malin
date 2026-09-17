import { describe, expect, it } from 'vitest';
import { CAPITALIZED_COMMON, extractEntities } from '../../src/text/entities';
import { normalizeForMatch } from '../../src/text/normalize';
import { createWordList } from '../../src/text/wordlist';

const KNOWN = createWordList([
  'le', 'la', 'les', 'un', 'une', 'de', 'du', 'des', 'et', 'est', 'sont', 'a', 'au', 'aux', 'en', 'dans', 'sur', 'il', 'elle', 'ils',
  'nous', 'soleil', 'terre', 'lune', 'pierre', 'rose', 'moyen', 'âge', 'siècle', 'roi', 'guerre', 'chat', 'chien', 'forêt', 'mer',
  'révolution', 'état', 'église', 'monde', 'brille', 'peut', 'être', 'ce', 'matin', 'nouveau', 'mes', 'amis', 'enfants', 'mi',
  'bonjour', 'maman', 'viens', 'dit', 'ramasse', 'parle', 'avec', 'voit', 'habite', 'rue', 'lit', 'approche', 'traverse', 'tourne',
  'autour', 'regardons', 'étoile', 'grande', 'mange', 'pays', 'aide', 'part', 'vers', 'voyage', 'partent', 'vont', 'unis', 'demain',
]);
const isKnown = (w: string): boolean => KNOWN.has(normalizeForMatch(w));
const ent = (text: string, contextText?: string) => extractEntities(text, isKnown, contextText === undefined ? undefined : { contextText });

describe('extractEntities — numbers and years', () => {
  it('extracts 4-digit years separately from numbers', () => {
    expect(ent('En 1789, le peuple se révolte.')).toEqual({ numbers: [], years: ['1789'], properNouns: [] });
  });

  it('matches trois and 3', () => {
    expect(ent('Il a trois chats.').numbers).toEqual(['3']);
    expect(ent('Il a 3 chats.').numbers).toEqual(ent('Il a trois chats.').numbers);
  });

  it('matches XIXe, 19e and dix-neuvième', () => {
    expect(ent('Au XIXe siècle, les usines se multiplient.').numbers).toEqual(['19e']);
    expect(ent('Au 19e siècle, les usines se multiplient.').numbers).toEqual(['19e']);
    expect(ent('Au dix-neuvième siècle, les usines se multiplient.').numbers).toEqual(['19e']);
    expect(ent('Au XIXème siècle.').numbers).toEqual(['19e']);
  });

  it('deduplicates equivalent numbers', () => {
    expect(ent('Il a 3 chats et trois chiens.').numbers).toEqual(['3']);
  });

  it('joins thousands groups separated by spaces', () => {
    expect(ent('La ville compte 10 000 habitants.').numbers).toEqual(['10000']);
    expect(ent('Environ 1 000 000 de personnes.').numbers).toEqual(['1000000']);
    expect(ent('Environ 2 500 élèves.').numbers).toEqual(['2500']);
  });

  it('keeps decimals', () => {
    expect(ent('Le sac pèse 3,5 kg.').numbers).toEqual(['3.5']);
  });

  it('applies scale words after digits', () => {
    expect(ent('La France compte 67 millions d’habitants.').numbers).toEqual(['67000000']);
    expect(ent('Il y a 2,5 milliards d’années.').numbers).toEqual(['2500000000']);
  });

  it('reads numbers written in letters, including multi-word ones', () => {
    expect(ent('Nous sommes en deux mille vingt-quatre.').numbers).toEqual(['2024']);
    expect(ent('Il y a vingt et un élèves.').numbers).toEqual(['21']);
    expect(ent('Elle a quatre-vingt-dix-sept ans.').numbers).toEqual(['97']);
    expect(ent('Deux cents moutons.').numbers).toEqual(['200']);
  });

  it('does not take the articles un / une for numbers', () => {
    expect(ent('Un chat et une souris jouent.').numbers).toEqual([]);
  });

  it('splits year ranges', () => {
    expect(ent('La guerre de 1914-1918 fut longue.').years).toEqual(['1914', '1918']);
  });

  it('reads roman numerals after a name or before siècle', () => {
    expect(ent('Le roi Louis XIV aimait danser.')).toEqual({ numbers: ['14'], years: [], properNouns: ['Louis'] });
    expect(ent('Lis le chapitre IV.').numbers).toEqual(['4']);
    expect(ent('Au Ve siècle, Rome tombe.').numbers).toEqual(['5e']);
    expect(ent('François Ier règne.').numbers).toEqual(['1e']);
  });

  it('does not read articles and pronouns as roman numerals', () => {
    expect(ent('Ce matin, Le chat De nouveau Mes amis Les enfants.').numbers).toEqual([]);
    expect(ent('Ce matin, il pleut.').numbers).toEqual([]);
  });

  it('reads ordinals written with digits or letters', () => {
    expect(ent('Le 1er mai est férié.').numbers).toEqual(['1e']);
    expect(ent('Pour la première fois.').numbers).toEqual(['1e']);
  });

  it('keeps small numbers and large non-year numbers in numbers', () => {
    expect(ent('En 52 av. J.-C., la Gaule est vaincue.')).toEqual({ numbers: ['52'], years: [], properNouns: ['Gaule'] });
    expect(ent('Il y a 3000 ans.')).toMatchObject({ numbers: ['3000'], years: [] });
    expect(ent('Vers 800, Charlemagne règne.')).toMatchObject({ numbers: ['800'], years: [], properNouns: ['Charlemagne'] });
  });

  it('extracts a number next to a proper noun', () => {
    expect(ent('La mission Apollo 11 part.')).toEqual({ numbers: ['11'], years: [], properNouns: ['Apollo'] });
  });
});

describe('extractEntities — proper nouns', () => {
  it('exempts capitalized common nouns at the start of a sentence', () => {
    expect(ent('Le Soleil est une étoile.').properNouns).toEqual([]);
    expect(ent('Soleil et Lune.').properNouns).toEqual([]);
  });

  it('exempts capitalized common nouns inside a sentence', () => {
    expect(ent('Nous regardons le Soleil et la Lune.').properNouns).toEqual([]);
    expect(ent('La Terre tourne autour du Soleil.').properNouns).toEqual([]);
    expect(ent('Noël approche.').properNouns).toEqual([]);
  });

  it('exempts multi-word common expressions', () => {
    expect(ent('Au Moyen Âge, les seigneurs vivent dans des châteaux.').properNouns).toEqual([]);
    expect(ent('La Révolution française commence.').properNouns).toEqual([]);
    expect(ent('La Voie lactée brille.').properNouns).toEqual([]);
  });

  it('finds the name after M. and other titles', () => {
    expect(ent('M. Dupont habite à Lyon.').properNouns).toEqual(['Dupont', 'Lyon']);
    expect(ent('Bonjour, M. Dupont !').properNouns).toEqual(['Dupont']);
    expect(ent('Mme Durand et le Dr Morel arrivent.').properNouns).toEqual(['Durand', 'Morel']);
    expect(ent('Madame Bovary lit.').properNouns).toEqual(['Bovary']);
  });

  it('finds a name after an elision', () => {
    expect(ent('Il part vers l’Afrique.').properNouns).toEqual(['Afrique']);
    expect(ent("Il part vers l'Afrique.").properNouns).toEqual(['Afrique']);
    expect(ent('L’Afrique est grande.').properNouns).toEqual(['Afrique']);
  });

  it('finds unknown capitalized words at the start of a sentence', () => {
    expect(ent('Paul mange.').properNouns).toEqual(['Paul']);
    expect(ent('Marie et Paul partent. Ils vont à Marseille.').properNouns).toEqual(['Marie', 'Paul', 'Marseille']);
  });

  it('does not treat a known word at the start of a sentence as a proper noun', () => {
    expect(ent('Pierre ramasse des fraises.').properNouns).toEqual([]);
  });

  it('treats a known capitalized word inside a sentence as a proper noun when its lowercase form is absent', () => {
    expect(ent('Il parle avec Pierre.').properNouns).toEqual(['Pierre']);
    expect(ent('Il voit Rose.').properNouns).toEqual(['Rose']);
  });

  it('does not treat it as a proper noun when the lowercase form is present in the text or the context', () => {
    expect(ent('Il ramasse une pierre et parle à Pierre.').properNouns).toEqual([]);
    expect(ent('Il parle à Pierre.', 'Une pierre roule.').properNouns).toEqual([]);
  });

  it('groups consecutive capitalized words', () => {
    expect(ent('Jules César conquiert la Gaule.').properNouns).toEqual(['Jules César', 'Gaule']);
    expect(ent('La Seine traverse Paris.').properNouns).toEqual(['Seine', 'Paris']);
  });

  it('keeps hyphenated names whole', () => {
    expect(ent('Il habite rue Victor-Hugo.').properNouns).toEqual(['Victor-Hugo']);
    expect(ent('Il visite les États-Unis.').properNouns).toEqual(['États-Unis']);
  });

  it('accepts acronyms but not uppercase known words', () => {
    expect(ent('L’ONU aide les pays.').properNouns).toEqual(['ONU']);
    expect(ent('LE SOLEIL BRILLE').properNouns).toEqual([]);
  });

  it('handles dialogues and quotes', () => {
    expect(ent('— Maman, viens ! dit Léo.').properNouns).toEqual(['Léo']);
    expect(ent('« Bonjour », dit Zoé.').properNouns).toEqual(['Zoé']);
  });

  it('deduplicates proper nouns', () => {
    expect(ent('Paul voit Paul et paul.').properNouns).toEqual(['Paul']);
  });

  it('ignores initials', () => {
    expect(ent('Un livre de J. K. Martin.').properNouns).toEqual(['Martin']);
  });

  it('never breaks on an empty text', () => {
    expect(ent('')).toEqual({ numbers: [], years: [], properNouns: [] });
  });
});

describe('extractEntities — table of cases', () => {
  const cases: readonly (readonly [string, Partial<ReturnType<typeof ent>>])[] = [
    ['Le Soleil se lève à l’est.', { properNouns: [] }],
    ['Au loin, le Soleil disparaît.', { properNouns: [] }],
    ['La Lune éclaire la Terre.', { properNouns: [] }],
    ['L’État construit des écoles.', { properNouns: [] }],
    ['Les moines prient dans l’Église.', { properNouns: [] }],
    ['Le Roi entre dans la salle.', { properNouns: [] }],
    ['Papa et Maman arrivent.', { properNouns: [] }],
    ['Le Nord est froid.', { properNouns: [] }],
    ['Il lit un livre sur l’Égypte.', { properNouns: ['Égypte'] }],
    ['Cléopâtre règne sur l’Égypte.', { properNouns: ['Cléopâtre', 'Égypte'] }],
    ['Demain, M. Martin et Mlle Petit visitent Rome.', { properNouns: ['Martin', 'Petit', 'Rome'] }],
    ['Vercingétorix se rend à César en 52 av. J.-C.', { numbers: ['52'], properNouns: ['Vercingétorix', 'César'] }],
    ['La Première Guerre mondiale dure de 1914 à 1918.', { years: ['1914', '1918'], properNouns: [] }],
    ['Le XXe siècle et le XXIe siècle.', { numbers: ['20e', '21e'] }],
    ['Au IIIe millénaire.', { numbers: ['3e'] }],
    ['Il a mangé cinq pommes et 5 poires.', { numbers: ['5'] }],
    ['Il y a soixante-dix élèves et 70 parents.', { numbers: ['70'] }],
    ['Un million de personnes, soit 1 000 000.', { numbers: ['1000000'] }],
    ['Le train part à la deuxième heure.', { numbers: ['2e'] }],
    ['Elle court 2,5 km en 1998.', { numbers: ['2.5'], years: ['1998'] }],
  ];

  it.each(cases)('%s', (text, expected) => {
    expect(ent(text)).toMatchObject(expected);
  });
});

describe('CAPITALIZED_COMMON', () => {
  it('contains the usual school nouns in lowercase', () => {
    for (const w of ['soleil', 'terre', 'lune', 'état', 'église', 'moyen âge']) expect(CAPITALIZED_COMMON.has(w)).toBe(true);
    for (const w of CAPITALIZED_COMMON) expect(w).toBe(w.toLowerCase());
  });
});
