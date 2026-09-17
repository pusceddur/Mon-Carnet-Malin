import { describe, expect, it } from 'vitest';
import { countSyllablesFr, readabilityFr } from '../../src/text/readability';

// Hand-annotated spoken syllables (standard French, careful speech): final mute e and verbal « -ent » are silent,
// inner e are pronounced (« sa-me-di »), glides are not split (« lion » 1, « science » 1).
const ANNOTATED: readonly (readonly [string, number])[] = [
  ['chat', 1], ['maison', 2], ['école', 2], ['photosynthèse', 4], ['enfant', 2], ['oiseau', 2], ['écureuil', 3], ['feuille', 1],
  ['travail', 2], ['soleil', 2], ['fille', 1], ['aujourd’hui', 3], ['extraordinaire', 5], ['poésie', 3], ['géographie', 4],
  ['créer', 2], ['théâtre', 2], ['pays', 2], ['hier', 1], ['piano', 2], ['ville', 1], ['jardin', 2], ['mangent', 1],
  ['grand-mère', 2], ['vingt-et-un', 3], ['œuf', 1], ['cœur', 1], ['Noël', 2], ['naïf', 2], ['ouvrier', 3], ['trois', 1],
  ['prière', 2], ['lumière', 2], ['février', 3], ['crier', 2], ['client', 2], ['bien', 1], ['chien', 1], ['attention', 3],
  ['nation', 2], ['lion', 1], ['violon', 2], ['nuage', 1], ['oui', 1], ['huit', 1], ['nuit', 1], ['bruit', 1], ['cruel', 2],
  ['voyage', 2], ['crayon', 2], ['payer', 2], ['yeux', 1], ['famille', 2], ['papillon', 3], ['travailler', 3], ['idée', 2],
  ['année', 2], ['rue', 1], ['statue', 2], ['avenue', 3], ['château', 2], ['banque', 1], ['langue', 1], ['quatre', 1],
  ['question', 2], ['guitare', 2], ['aiguille', 2], ['table', 1], ['tables', 1], ['les', 1], ['étudient', 3], ['mangeaient', 2],
  ['voient', 1], ['souvent', 2], ['moment', 2], ['vent', 1], ['parents', 2], ['lentement', 3], ['alcool', 2], ['zoo', 1],
  ['chaos', 2], ['réel', 2], ['idées', 2], ['créée', 2], ['poète', 2], ['aéroport', 4], ['extérieur', 3], ['électricité', 5],
  ['mathématiques', 4], ['hippopotame', 4], ['crocodile', 3], ['éléphant', 3], ['dinosaure', 3], ['température', 4],
  ['ordinateur', 4], ['bibliothèque', 4], ['mercredi', 3], ['samedi', 3], ['maintenant', 3], ['boulangerie', 4],
  ['professeur', 3], ['escargot', 3], ['fourmi', 2], ['hirondelle', 3], ['grenouille', 2], ['forêt', 2], ['montagne', 2],
  ['rivière', 2], ['océan', 3], ['réalité', 4], ['musée', 2], ['journée', 2], ['cheveux', 2], ['genou', 2], ['heureux', 2],
  ['malheureusement', 5], ['doucement', 3], ['histoire', 2], ['géant', 2], ['européen', 4], ['science', 1], ['patient', 2],
  ['radio', 2], ['société', 3], ['pied', 1], ['premier', 2], ['dernier', 2], ['escalier', 3], ['tablier', 3], ['sanglier', 3],
  ['monsieur', 2], ['femme', 1], ['second', 2], ['oignon', 2], ['finissent', 2], ['aiment', 1], ['dorment', 1], ['accident', 3],
  ['arc-en-ciel', 3], ['quatre-vingt-dix', 4], ['l’arbre', 1], ['qu’il', 1], ['jusqu’à', 2], ['Égypte', 2], ['cygne', 1],
  ['style', 1], ['rythme', 1], ['abbaye', 3], ['paysage', 3],
];

describe('countSyllablesFr', () => {
  it('has at least 100 annotated words', () => {
    expect(ANNOTATED.length).toBeGreaterThanOrEqual(100);
  });

  it('is within ±1 syllable on at least 90 % of the annotated words (and mostly exact)', () => {
    const results = ANNOTATED.map(([word, expected]) => ({ word, expected, got: countSyllablesFr(word) }));
    const withinOne = results.filter((r) => Math.abs(r.got - r.expected) <= 1).length / results.length;
    const exact = results.filter((r) => r.got === r.expected).length / results.length;
    const misses = results.filter((r) => r.got !== r.expected).map((r) => `${r.word}: ${r.got}/${r.expected}`);
    expect(withinOne, misses.join(', ')).toBeGreaterThanOrEqual(0.9);
    expect(exact, misses.join(', ')).toBeGreaterThanOrEqual(0.9);
  });

  it('handles edge cases', () => {
    expect(countSyllablesFr('')).toBe(0);
    expect(countSyllablesFr('...')).toBe(0);
    expect(countSyllablesFr('y')).toBe(1);
    expect(countSyllablesFr('ÉCOLE')).toBe(2);
    expect(countSyllablesFr('« école »')).toBe(2);
    expect(countSyllablesFr('1914')).toBe(3);
    expect(countSyllablesFr('7')).toBe(1);
  });
});

describe('readabilityFr', () => {
  it('counts words and sentences, ignoring elided clitics', () => {
    const report = readabilityFr('Le chat dort. L’arbre pousse vite aujourd’hui !');
    expect(report.words).toBe(7);
    expect(report.sentences).toBe(2);
    expect(report.avgWordsPerSentence).toBe(3.5);
    expect(report.maxWordsPerSentence).toBe(4);
    expect(report.longWordRatio).toBe(0);
  });

  it('computes the long word ratio (≥ 4 syllables) and honours exempt words', () => {
    const text = 'La photosynthèse transforme la lumière.';
    expect(readabilityFr(text).longWordRatio).toBe(0.2);
    expect(readabilityFr(text, ['Photosynthèse']).longWordRatio).toBe(0);
    expect(readabilityFr('Les températures augmentent.', ['température', 'temperatures']).longWordRatio).toBe(0);
  });

  it('computes the Kandel-Moles score (easier text scores higher)', () => {
    const easy = readabilityFr('Le chat boit du lait. Il dort. Il joue.');
    const hard = readabilityFr('L’organisation internationale coordonne quotidiennement les administrations gouvernementales européennes et les institutions universitaires particulièrement préoccupées.');
    expect(easy.kandelMoles).toBeGreaterThan(hard.kandelMoles);
    expect(easy.kandelMoles).toBeGreaterThan(80);
    // 207 − 1.015 × 3 − 73.6 × (3 / 3) for « Le chat dort. »
    expect(readabilityFr('Le chat dort.').kandelMoles).toBeCloseTo(207 - 1.015 * 3 - 73.6, 1);
  });

  it('returns zeros for an empty text', () => {
    expect(readabilityFr('   ')).toEqual({ words: 0, sentences: 0, avgWordsPerSentence: 0, maxWordsPerSentence: 0, longWordRatio: 0, kandelMoles: 0 });
  });

  it('measures the longest sentence', () => {
    const report = readabilityFr('Un deux trois. Un deux trois quatre cinq six sept huit neuf dix. Fin.');
    expect(report.sentences).toBe(3);
    expect(report.maxWordsPerSentence).toBe(10);
    expect(report.avgWordsPerSentence).toBe(4.67);
  });
});
