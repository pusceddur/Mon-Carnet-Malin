import { normalizeForMatch } from './normalize';

// French function words and very frequent verbs, in normalizeForMatch form (no accents).
const WORDS = `
a ai aie aient aies ait as au aucun aucune aupres auquel aura aurai auraient aurais aurait aux avaient avais avait avant avec avez aviez
avions avoir avons ayant c ca car ce ceci cela celle celles celui cependant ces cet cette ceux chaque chez ci combien comme comment d
dans de depuis des desquels dont du duquel elle elles en encore entre es est et etaient etais etait etant ete etes etre eu eux fait
faire fais faisait font fut furent ici il ils j je jusqu jusque l la laquelle le lequel les lesquels leur leurs lors lorsqu lorsque lui m
ma mais me meme memes mes moi moins mon n ne ni non nos notre nous on ont ou ou par parce pas peu peut peuvent plus pour pourquoi
puis puisqu puisque qu quand que quel quelle quelles quels qui quoi s sa sans se sera serai seraient serait ses si sien soi soit sommes
son sont sous suis sur t ta te tes toi ton tous tout toute toutes tres tu un une unes uns vers voici voila vont vos votre vous y deja
aussi alors ainsi donc or bien tres trop peu apres pendant contre selon parmi chacun chacune autre autres quelque quelques tel telle
tels telles celui-ci cela oui
`;

export const STOPWORDS_FR: ReadonlySet<string> = new Set(
  WORDS.split(/\s+/).map((w) => normalizeForMatch(w)).filter((w) => w.length > 0 && !w.includes(' ')),
);

/** normalizeForMatch form is a stopword? */
export function isStopword(normalized: string): boolean {
  return STOPWORDS_FR.has(normalized);
}

const STEM_SUFFIXES = [
  'issements', 'issement', 'issantes', 'issante', 'issants', 'issant', 'eraient', 'assions', 'ations', 'ation', 'ements', 'ement',
  'euses', 'euse', 'aient', 'erait', 'erons', 'eront', 'ions', 'iez', 'ait', 'ais', 'ant', 'ent', 'ons', 'ees', 'ee', 'es', 'ez',
  'er', 'ir', 're', 'e', 's', 'x',
];

/** Light deterministic stem of a normalizeForMatch word (« mangeait », « manger », « mangent » → « mang »). */
export function lightStem(normalized: string): string {
  let w = normalized;
  if (w.length > 4 && /[sx]$/.test(w)) w = w.slice(0, -1);
  for (const suffix of STEM_SUFFIXES) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}
