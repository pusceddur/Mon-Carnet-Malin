import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeWikitext,
  chooseEntry,
  cleanWikitext,
  definitionLines,
  detectInflection,
  extractFrenchSection,
  lemmaFromFlexionTemplates,
  listPosSections,
} from '../../src/dictionary/wikitext';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const fixture = (name: string): string => readFileSync(join(FIXTURES, `${name}.wikitext`), 'utf8');

type Expected =
  | { kind: 'definition'; partOfSpeech: string; definition: string }
  | { kind: 'inflection'; partOfSpeech: string; lemma: string; description: string }
  | { kind: 'none' };

const CASES: Record<string, Expected> = {
  chat: { kind: 'definition', partOfSpeech: 'nom', definition: 'Mammifère carnivore félin de taille moyenne, au museau court et arrondi, domestiqué ou sauvage.' },
  cheval: { kind: 'definition', partOfSpeech: 'nom', definition: 'Grand mammifère herbivore de la famille des équidés, domestiqué et employé comme monture ou comme bête de trait.' },
  chevaux: { kind: 'inflection', partOfSpeech: 'nom', lemma: 'cheval', description: 'Pluriel de cheval.' },
  manger: { kind: 'definition', partOfSpeech: 'verbe', definition: 'Mâcher et avaler un aliment pour se nourrir.' },
  mangeait: { kind: 'inflection', partOfSpeech: 'verbe', lemma: 'manger', description: 'Troisième personne du singulier de l’imparfait de l’indicatif de manger.' },
  'mange-participe': { kind: 'inflection', partOfSpeech: 'verbe', lemma: 'manger', description: 'Participe passé masculin singulier de manger.' },
  petit: { kind: 'definition', partOfSpeech: 'adjectif', definition: 'Dont la taille, la grandeur ou l’étendue est inférieure à la moyenne.' },
  petite: { kind: 'inflection', partOfSpeech: 'adjectif', lemma: 'petit', description: 'Féminin singulier de petit.' },
  belles: { kind: 'inflection', partOfSpeech: 'adjectif', lemma: 'beau', description: 'Féminin pluriel de beau.' },
  beau: { kind: 'definition', partOfSpeech: 'nom', definition: 'Ce qui est beau, ce qui plaît aux yeux.' },
  finis: { kind: 'inflection', partOfSpeech: 'verbe', lemma: 'finir', description: 'Première personne du singulier du présent de l’indicatif de finir.' },
  livre: { kind: 'definition', partOfSpeech: 'nom', definition: 'Assemblage de feuilles imprimées et reliées ensemble, formant un volume.' },
  est: { kind: 'definition', partOfSpeech: 'nom', definition: 'Un des quatre points cardinaux, direction où le soleil se lève.' },
  hello: { kind: 'none' },
  rose: { kind: 'definition', partOfSpeech: 'nom', definition: 'Fleur du rosier, souvent très parfumée.' },
  gribouiller: { kind: 'definition', partOfSpeech: 'verbe', definition: 'Faire des gribouillis, écrire ou dessiner de façon désordonnée.' },
  photosynthese: {
    kind: 'definition',
    partOfSpeech: 'nom',
    definition: 'Processus par lequel les plantes vertes fabriquent leur matière organique grâce à la lumière, à l’eau et au dioxyde de carbone, en utilisant la chlorophylle.',
  },
  aujourdhui: { kind: 'definition', partOfSpeech: 'adverbe', definition: 'Au jour où l’on est, ce jour-ci.' },
  yeux: { kind: 'inflection', partOfSpeech: 'nom', lemma: 'œil', description: 'Pluriel de œil.' },
  oeil: { kind: 'definition', partOfSpeech: 'nom', definition: 'Organe de la vue.' },
  fleur: { kind: 'definition', partOfSpeech: 'nom', definition: 'Partie souvent colorée de la plante, qui porte les organes de la reproduction et donne ensuite le fruit.' },
  jolies: { kind: 'inflection', partOfSpeech: 'adjectif', lemma: 'joli', description: 'Féminin pluriel de joli.' },
  joli: { kind: 'definition', partOfSpeech: 'adjectif', definition: 'Qui est agréable à regarder ; mignon.' },
  clef: { kind: 'inflection', partOfSpeech: 'nom', lemma: 'clé', description: 'Variante orthographique de clé.' },
  cle: { kind: 'definition', partOfSpeech: 'nom', definition: 'Petit objet en métal qui sert à ouvrir et à fermer une serrure.' },
  paris: { kind: 'definition', partOfSpeech: 'nom propre', definition: 'Ville et capitale de la France, située sur la Seine.' },
  bonjour: { kind: 'definition', partOfSpeech: 'interjection', definition: 'Salutation utilisée quand on rencontre quelqu’un dans la journée.' },
  vite: { kind: 'definition', partOfSpeech: 'adverbe', definition: 'Avec rapidité ; en peu de temps.' },
  grandissait: { kind: 'inflection', partOfSpeech: 'verbe', lemma: 'grandir', description: 'Forme conjuguée de grandir.' },
  grandir: { kind: 'definition', partOfSpeech: 'verbe', definition: 'Devenir plus grand.' },
  soleil: { kind: 'definition', partOfSpeech: 'nom', definition: 'Étoile autour de laquelle tourne la Terre ; elle nous donne la lumière et la chaleur.' },
  chantions: { kind: 'inflection', partOfSpeech: 'verbe', lemma: 'chanter', description: 'Première personne du pluriel de l’imparfait de l’indicatif de chanter.' },
  chanter: { kind: 'definition', partOfSpeech: 'verbe', definition: 'Produire avec la voix des sons musicaux.' },
};

describe('wikitext fixtures', () => {
  it('has at least 20 realistic wikitext fixtures, all covered by a case', () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.wikitext')).map((f) => f.replace(/\.wikitext$/, ''));
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(files.sort()).toEqual(Object.keys(CASES).sort());
  });

  for (const [name, expected] of Object.entries(CASES)) {
    it(`parses ${name}`, () => {
      const choice = chooseEntry(analyzeWikitext(fixture(name)));
      if (expected.kind === 'none') {
        expect(choice).toBeNull();
        return;
      }
      expect(choice).toMatchObject(expected);
    });
  }
});

describe('sections', () => {
  it('extracts only the French section, even when another language comes first', () => {
    const french = extractFrenchSection(fixture('rose'));
    expect(french).toContain('[[rosier]]');
    expect(french).not.toContain('{{langue|de}}');
    expect(french).not.toContain('rise');
    expect(extractFrenchSection(fixture('hello'))).toBeNull();
  });

  it('lists part-of-speech sections with French labels, flexion flag and without non-POS sections', () => {
    const sections = listPosSections(extractFrenchSection(fixture('livre')) ?? '');
    expect(sections.map((s) => [s.partOfSpeech, s.flexion])).toEqual([
      ['nom', false],
      ['nom', false],
      ['verbe', true],
    ]);
  });

  it('keeps only first-level definitions (skips #*, #: and ##)', () => {
    const lines = definitionLines('# Un.\n#* exemple\n#: note\n## sous-sens\n# Deux.\n #pas en début de ligne');
    expect(lines).toEqual(['Un.', 'Deux.']);
  });

  it('page without French section has no entries', () => {
    const analysis = analyzeWikitext(fixture('hello'));
    expect(analysis).toEqual({ hasFrench: false, definitions: [], inflections: [] });
  });

  it('homographs: lemma sections are listed in page order and inflections are kept aside', () => {
    const livre = analyzeWikitext(fixture('livre'));
    expect(livre.definitions.map((d) => d.definition)).toEqual([
      'Assemblage de feuilles imprimées et reliées ensemble, formant un volume.',
      'Ancienne unité de masse valant environ un demi-kilogramme.',
    ]);
    expect(livre.inflections.map((i) => i.lemma)).toEqual(['livrer']);

    const est = analyzeWikitext(fixture('est'));
    expect(est.inflections[0]?.lemma).toBe('être');
    expect(est.definitions.map((d) => d.partOfSpeech)).toEqual(['nom', 'adjectif']);
  });

  it('prefers the requested part of speech when following a lemma', () => {
    const beau = analyzeWikitext(fixture('beau'));
    expect(chooseEntry(beau, 'adjectif')).toMatchObject({
      kind: 'definition',
      partOfSpeech: 'adjectif',
      definition: 'Qui fait naître un sentiment d’admiration par sa forme, ses couleurs ou sa grâce.',
    });
    expect(chooseEntry(beau, 'verbe')).toMatchObject({ partOfSpeech: 'nom' });
  });

  it('skips definition stubs', () => {
    const analysis = analyzeWikitext(fixture('gribouiller'));
    expect(analysis.definitions).toHaveLength(1);
    expect(analysis.definitions[0]?.definition.startsWith('Faire des gribouillis')).toBe(true);
  });
});

describe('cleanWikitext', () => {
  it.each([
    ['{{lien|chat|fr}} noir', 'chat noir'],
    ['{{lien|chevaux|fr|dif=cheval}}', 'cheval'],
    ['un [[animal|animal]] et un [[oiseau]]', 'un animal et un oiseau'],
    ['[[chanter#fr|Chanter]] fort', 'Chanter fort'],
    ["'''gras''' et ''italique'' et '''''les deux'''''", 'gras et italique et les deux'],
    ['texte<ref>une note</ref>.', 'texte.'],
    ['texte<ref name="a" />.', 'texte.'],
    ['<!-- commentaire -->Texte', 'Texte'],
    ['{{term|Marine}} Partie du navire.', 'Partie du navire.'],
    ['{{lexique|botanique|zoologie|fr}} {{figuré|fr}} Sens imagé.', 'Sens imagé.'],
    ['{{lexique|{{lien|x|fr}}|fr}} Définition.', 'Définition.'],
    ['Au {{siècle|XIX}}, on voyageait.', 'Au XIXe siècle, on voyageait.'],
    ['{{Unité|2000}} kilogrammes', '2000 kilogrammes'],
    ['la {{w|Seine}} et la {{w|Loire (fleuve)|Loire}}', 'la Seine et la Loire'],
    ['[[Fichier:Chat.jpg|vignette|Un [[chat]] noir]] Texte', 'Texte'],
    ['[[w:Paris|Paris]] et [[en:cat]]', 'Paris et'],
    ['A&nbsp;; b &#x2019; c &amp; d', 'A ; b ’ c & d'],
    ['Liste<br/>suite', 'Liste suite'],
    ['( ) Reste', 'Reste'],
    ['{{formatnum:1000}} habitants', '1000 habitants'],
    ['la {{8e|édition}}', 'la 8e édition'],
  ])('%s → %s', (raw, expected) => {
    expect(cleanWikitext(raw)).toBe(expected);
  });
});

describe('inflections', () => {
  it.each([
    ["''Pluriel de'' [[cheval]].", 'cheval'],
    ["''Féminin pluriel de'' {{lien|joli|fr}}.", 'joli'],
    ["''Deuxième personne du pluriel de l’impératif présent de'' [[aller]].", 'aller'],
    ["''Participe présent de'' [[chanter]].", 'chanter'],
    ["''Masculin et féminin pluriel de'' [[rouge]].", 'rouge'],
    ["''Ancienne orthographe de'' [[poète]].", 'poète'],
  ])('detects %s', (raw, lemma) => {
    expect(detectInflection(raw)?.lemma).toBe(lemma);
  });

  it.each([
    "Personne qui s’occupe d’un [[jardin]].",
    'Petit du [[chat]].',
    'Fils de [[roi]].',
    "Partie de la [[plante]] qui porte la graine.",
    'Aucun lien ici.',
  ])('ignores real definitions: %s', (raw) => {
    expect(detectInflection(raw)).toBeNull();
  });

  it('reads the lemma from inflection box templates', () => {
    expect(lemmaFromFlexionTemplates('{{fr-verbe-flexion|grandir|ind.i.3s=oui}}')).toBe('grandir');
    expect(lemmaFromFlexionTemplates('{{fr-verbe-flexion|grp=3|être|ind.p.3s=oui}}')).toBe('être');
    expect(lemmaFromFlexionTemplates('{{fr-accord-rég|pə.ti|ms=petit}}')).toBe('petit');
    expect(lemmaFromFlexionTemplates('{{fr-rég|bɛl|s=belle}}')).toBe('belle');
    expect(lemmaFromFlexionTemplates('rien')).toBeNull();
  });
});
