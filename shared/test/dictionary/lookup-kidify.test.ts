import { describe, expect, it } from 'vitest';
import { countWords } from '../../src/ai/limits';
import { kidifyDefinition } from '../../src/dictionary/kidify';
import { lookupGlossary } from '../../src/dictionary/lookup';
import type { GlossaryEntry } from '../../src/types/dictionary';

const PARENT: readonly GlossaryEntry[] = [
  { headword: 'volcan', partOfSpeech: 'nom', kidDefinition: 'Montagne de feu (définition du parent).', example: null },
  { headword: 'dragonnet', partOfSpeech: 'nom', kidDefinition: 'Petit dragon.', example: null, forms: ['dragonnets'] },
  { headword: 'Tartiflette', partOfSpeech: 'nom', kidDefinition: 'Plat de montagne.', example: null },
];

describe('lookupGlossary', () => {
  it('finds a headword', () => {
    expect(lookupGlossary('volcan')).toMatchObject({ source: 'glossaire', lemma: 'volcan', entry: { headword: 'volcan' } });
  });

  it('is case insensitive and ignores surrounding punctuation', () => {
    expect(lookupGlossary('Volcan')?.entry.headword).toBe('volcan');
    expect(lookupGlossary('« volcans »,')?.entry.headword).toBe('volcan');
  });

  it('uses explicit forms and lemma heuristics', () => {
    expect(lookupGlossary('volcans')?.entry.headword).toBe('volcan');
    expect(lookupGlossary('châteaux')?.entry.headword).toBe('château');
    expect(lookupGlossary('hésitaient')?.entry.headword).toBe('hésiter');
    expect(lookupGlossary('murmurant')?.entry.headword).toBe('murmurer');
    expect(lookupGlossary('aperçurent')?.entry.headword).toBe('apercevoir');
    expect(lookupGlossary('curieuse')?.entry.headword).toBe('curiosité');
    expect(lookupGlossary('grimpions')?.entry.headword).toBe('grimper');
  });

  it('strips elisions and pronominal forms', () => {
    expect(lookupGlossary('l’équateur')?.entry.headword).toBe('équateur');
    expect(lookupGlossary("d'énergie")?.entry.headword).toBe('énergie');
    expect(lookupGlossary('s’enfuit')?.entry.headword).toBe('enfuir');
    expect(lookupGlossary('s’emparèrent')?.entry.headword).toBe('emparer');
  });

  it('gives parent entries precedence and reports the source', () => {
    expect(lookupGlossary('volcan', PARENT)).toMatchObject({ source: 'glossaire_parent', lemma: 'volcan', entry: { kidDefinition: 'Montagne de feu (définition du parent).' } });
    expect(lookupGlossary('dragonnets', PARENT)).toMatchObject({ source: 'glossaire_parent', lemma: 'dragonnet' });
    expect(lookupGlossary('tartiflette', PARENT)?.source).toBe('glossaire_parent');
    expect(lookupGlossary('fleuve', PARENT)?.source).toBe('glossaire');
    expect(lookupGlossary('volcan', [])?.source).toBe('glossaire');
  });

  it('prefers the exact word over a heuristic lemma', () => {
    expect(lookupGlossary('reste')?.entry.headword).toBe('reste');
    expect(lookupGlossary('droite')?.entry.headword).toBe('droite');
    expect(lookupGlossary('droits')?.entry.headword).toBe('droit');
  });

  it('does not map auxiliary forms onto glossary nouns', () => {
    expect(lookupGlossary('sommes')).toBeNull();
    expect(lookupGlossary('est')).toBeNull();
  });

  it('matches without accents only when the word has none', () => {
    expect(lookupGlossary('foret')).toBeNull();
    expect(lookupGlossary('ecosysteme')?.entry.headword).toBe('écosystème');
    expect(lookupGlossary('meteo')?.entry.headword).toBe('météo');
    expect(lookupGlossary('côté')).toBeNull();
  });

  it('returns null for unknown or empty words', () => {
    expect(lookupGlossary('zorglub')).toBeNull();
    expect(lookupGlossary('')).toBeNull();
    expect(lookupGlossary('   ')).toBeNull();
  });
});

describe('kidifyDefinition', () => {
  it('removes labels in parentheses and brackets', () => {
    expect(kidifyDefinition('(Botanique) Partie de la plante qui porte les fleurs.')).toEqual({ text: 'Partie de la plante qui porte les fleurs.', kidFriendly: true });
    expect(kidifyDefinition('[Zoologie] Animal qui vit dans l’eau.').text).toBe('Animal qui vit dans l’eau.');
    expect(kidifyDefinition('Grand oiseau (Aquila) qui vole haut (au-dessus des montagnes).').text).toBe('Grand oiseau qui vole haut.');
  });

  it('removes label prefixes without parentheses', () => {
    expect(kidifyDefinition('Figuré : Personne très courageuse.').text).toBe('Personne très courageuse.');
    expect(kidifyDefinition('(Familier) Figuré. Chose sans valeur.').text).toBe('Chose sans valeur.');
  });

  it('keeps only the first definition', () => {
    expect(kidifyDefinition('1. Petit cours d’eau.\n2. Écoulement de larmes.').text).toBe('Petit cours d’eau.');
    expect(kidifyDefinition('# Siège pour une personne.\n# Poste important.').text).toBe('Siège pour une personne.');
    expect(kidifyDefinition('1. Petit cours d’eau. 2. Écoulement de larmes.').text).toBe('Petit cours d’eau.');
  });

  it('removes cross-references', () => {
    expect(kidifyDefinition('Mammifère carnivore domestique. Voir aussi félin.').text).toBe('Mammifère carnivore domestique.');
    expect(kidifyDefinition('Petit bateau → voir barque.').text).toBe('Petit bateau.');
    expect(kidifyDefinition('Lieu planté d’arbres. Synonyme : bois.').text).toBe('Lieu planté d’arbres.');
  });

  it('adds a capital letter and a final point', () => {
    expect(kidifyDefinition('petit cours d’eau')).toEqual({ text: 'Petit cours d’eau.', kidFriendly: true });
  });

  it('cuts at complete sentences within the word limit', () => {
    const raw = 'Grand animal de la savane. Il a une trompe et de grandes oreilles. Il vit en troupeau et mange beaucoup de plantes chaque jour pendant de longues heures.';
    const result = kidifyDefinition(raw, 16);
    expect(result.text).toBe('Grand animal de la savane. Il a une trompe et de grandes oreilles.');
    expect(countWords(result.text)).toBeLessThanOrEqual(16);
    expect(result.kidFriendly).toBe(true);
    expect(countWords(kidifyDefinition(raw).text)).toBeLessThanOrEqual(30);
  });

  it('cuts a too long first sentence at a clause boundary', () => {
    const raw = 'Instrument de musique à cordes frappées, muni d’un clavier, dont les marteaux frappent des cordes tendues dans une grande caisse de bois vernie qui résonne très fort dans la pièce.';
    const result = kidifyDefinition(raw, 12);
    expect(result.text).toBe('Instrument de musique à cordes frappées, muni d’un clavier.');
    expect(countWords(result.text)).toBeLessThanOrEqual(12);
  });

  it('marks a hard cut as not kid friendly', () => {
    const raw = 'Substance organique azotée complexe constituée de longues chaînes d’acides aminés liés entre eux par des liaisons peptidiques et repliées en structures tridimensionnelles';
    const result = kidifyDefinition(raw, 10);
    expect(result.text.endsWith('…')).toBe(true);
    expect(result.kidFriendly).toBe(false);
  });

  it('marks complex vocabulary as not kid friendly', () => {
    expect(kidifyDefinition('Polymérisation hétérogène catalysée thermodynamiquement.').kidFriendly).toBe(false);
  });

  it('marks leftover markup as not kid friendly', () => {
    expect(kidifyDefinition('Petit {{lien|animal}} domestique.').kidFriendly).toBe(false);
  });

  it('returns an empty result for empty input', () => {
    expect(kidifyDefinition('')).toEqual({ text: '', kidFriendly: false });
    expect(kidifyDefinition('(Botanique)')).toEqual({ text: '', kidFriendly: false });
    expect(kidifyDefinition('Voir chat.')).toEqual({ text: '', kidFriendly: false });
  });

  it('is deterministic', () => {
    const raw = '(Zoologie) Oiseau de nuit. Il chasse les souris.';
    expect(kidifyDefinition(raw)).toEqual(kidifyDefinition(raw));
  });
});
