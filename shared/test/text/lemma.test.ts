import { describe, expect, it } from 'vitest';
import { lemmaCandidateTiers, lemmaCandidates } from '../../src/text/lemma';

describe('lemmaCandidates', () => {
  it('starts with the word itself in lowercase', () => {
    expect(lemmaCandidates('Chevaux')[0]).toBe('chevaux');
    expect(lemmaCandidates('volcan')).toEqual(['volcan']);
    expect(lemmaCandidates('  Forêt, ')[0]).toBe('forêt,');
    expect(lemmaCandidates('  Forêt, ')).toContain('forêt');
  });

  it.each([
    ['yeux', 'œil'], ['cieux', 'ciel'], ['travaux', 'travail'], ['messieurs', 'monsieur'], ['belle', 'beau'], ['vieille', 'vieux'],
    ['nouvelle', 'nouveau'], ['douce', 'doux'], ['blanche', 'blanc'], ['longue', 'long'],
  ])('irregular noun/adjective %s → %s', (word, lemma) => {
    expect(lemmaCandidates(word)).toContain(lemma);
  });

  it.each([
    ['était', 'être'], ['sommes', 'être'], ['furent', 'être'], ['ont', 'avoir'], ['eurent', 'avoir'], ['font', 'faire'],
    ['fit', 'faire'], ['vont', 'aller'], ['ira', 'aller'], ['peuvent', 'pouvoir'], ['veut', 'vouloir'], ['sait', 'savoir'],
    ['voient', 'voir'], ['vit', 'voir'], ['vit', 'vivre'], ['viennent', 'venir'], ['devint', 'devenir'], ['souviens', 'souvenir'],
    ['tient', 'tenir'], ['obtenu', 'obtenir'], ['prennent', 'prendre'], ['appris', 'apprendre'], ['compris', 'comprendre'],
    ['mis', 'mettre'], ['promet', 'promettre'], ['doit', 'devoir'], ['faut', 'falloir'], ['né', 'naître'], ['meurt', 'mourir'],
    ['vécut', 'vivre'], ['court', 'courir'], ['connaît', 'connaître'], ['connait', 'connaître'], ['disparut', 'disparaître'],
    ['croient', 'croire'], ['boivent', 'boire'], ['écrivent', 'écrire'], ['décrit', 'décrire'], ['lisent', 'lire'],
    ['ouvert', 'ouvrir'], ['découvre', 'découvrir'], ['offert', 'offrir'], ['reçoit', 'recevoir'], ['aperçut', 'apercevoir'],
    ['part', 'partir'], ['sort', 'sortir'], ['dort', 'dormir'], ['sent', 'sentir'], ['suit', 'suivre'], ['plaît', 'plaire'],
    ['pleut', 'pleuvoir'], ['peint', 'peindre'], ['éteint', 'éteindre'], ['craint', 'craindre'], ['rejoint', 'rejoindre'],
    ['construit', 'construire'], ['conduisent', 'conduire'], ['bat', 'battre'], ['rit', 'rire'], ['assis', 'asseoir'],
    ['cueille', 'cueillir'], ['fuient', 'fuir'], ['enfuit', 'enfuir'], ['envoie', 'envoyer'], ['conquit', 'conquérir'],
    ['vainquit', 'vaincre'], ['dissout', 'dissoudre'], ['résolu', 'résoudre'], ['dit', 'dire'],
  ])('irregular verb form %s → %s', (word, lemma) => {
    expect(lemmaCandidates(word)).toContain(lemma);
  });

  it.each([
    ['chats', 'chat'], ['chevaux', 'cheval'], ['animaux', 'animal'], ['tuyaux', 'tuyau'], ['bateaux', 'bateau'], ['jeux', 'jeu'],
    ['genoux', 'genou'], ['grandes', 'grand'], ['amie', 'ami'], ['sportive', 'sportif'], ['danseuse', 'danseur'],
    ['heureuses', 'heureux'], ['actrice', 'acteur'], ['ancienne', 'ancien'], ['bonne', 'bon'], ['naturelle', 'naturel'],
    ['muette', 'muet'], ['première', 'premier'], ['publique', 'public'], ['publiques', 'public'], ['complète', 'complet'],
    ['gentille', 'gentil'], ['grosse', 'gros'],
  ])('plural / feminine %s → %s', (word, lemma) => {
    expect(lemmaCandidates(word)).toContain(lemma);
  });

  it.each([
    ['mange', 'manger'], ['manges', 'manger'], ['mangeons', 'manger'], ['mangez', 'manger'], ['mangent', 'manger'],
    ['mangeait', 'manger'], ['mangeaient', 'manger'], ['mangea', 'manger'], ['mangèrent', 'manger'], ['mangera', 'manger'],
    ['mangeraient', 'manger'], ['mangé', 'manger'], ['mangée', 'manger'], ['mangeant', 'manger'], ['commençons', 'commencer'],
    ['commençait', 'commencer'], ['lève', 'lever'], ['achète', 'acheter'], ['appellent', 'appeler'], ['jette', 'jeter'],
    ['cède', 'céder'], ['préfère', 'préférer'], ['nettoie', 'nettoyer'], ['essuie', 'essuyer'], ['paie', 'payer'],
    ['hésita', 'hésiter'], ['murmurèrent', 'murmurer'], ['grimpaient', 'grimper'],
  ])('first group %s → %s', (word, lemma) => {
    expect(lemmaCandidates(word)).toContain(lemma);
  });

  it.each([
    ['finit', 'finir'], ['finissent', 'finir'], ['finissait', 'finir'], ['finira', 'finir'], ['finirent', 'finir'], ['fini', 'finir'],
    ['finie', 'finir'], ['choisissons', 'choisir'], ['attend', 'attendre'], ['attendent', 'attendre'], ['attendait', 'attendre'],
    ['attendra', 'attendre'], ['attendu', 'attendre'], ['répondirent', 'répondre'], ['vendue', 'vendre'],
  ])('second and third group %s → %s', (word, lemma) => {
    expect(lemmaCandidates(word)).toContain(lemma);
  });

  it('strips elisions', () => {
    expect(lemmaCandidates('l’arbre')).toContain('arbre');
    expect(lemmaCandidates("d'eau")).toContain('eau');
    expect(lemmaCandidates('s’enfuit')).toContain('enfuir');
    expect(lemmaCandidates('qu’elles')).toContain('elle');
    expect(lemmaCandidates('jusqu’au')).toContain('au');
    expect(lemmaCandidates('aujourd’hui')[0]).toBe('aujourd’hui');
  });

  it('turns adverbs in -ment back into adjectives', () => {
    expect(lemmaCandidates('doucement')).toContain('douce');
    expect(lemmaCandidates('heureusement')).toContain('heureux');
    expect(lemmaCandidates('prudemment')).toContain('prudent');
    expect(lemmaCandidates('vraiment')).toContain('vrai');
  });

  it('does not add suffix heuristics to auxiliary forms', () => {
    const tiers = lemmaCandidateTiers('sommes');
    expect(tiers.irregular).toEqual(['être']);
    expect(tiers.heuristic).toEqual([]);
    expect(lemmaCandidates('sommes')).not.toContain('somme');
  });

  it('keeps both lemmas of ambiguous forms', () => {
    expect(lemmaCandidates('suis')).toEqual(expect.arrayContaining(['être', 'suivre']));
  });

  it('prefers the most specific suffix rule', () => {
    const candidates = lemmaCandidates('mangeons');
    expect(candidates.indexOf('manger')).toBeLessThan(candidates.indexOf('mangeer'));
    expect(lemmaCandidates('chevaux')[1]).toBe('cheval');
  });

  it('returns unique non-empty candidates and never throws', () => {
    for (const w of ['', ' ', 'a', 'é', 'xx', '123', 'l’', '---']) {
      const c = lemmaCandidates(w);
      expect(new Set(c).size).toBe(c.length);
      expect(c.every((x) => x.length > 0)).toBe(true);
    }
  });
});
