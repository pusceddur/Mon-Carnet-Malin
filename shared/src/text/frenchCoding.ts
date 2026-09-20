// §26 « Couleurs de lecture »: French reading aids computed from the text alone, on the device, in microseconds (measured on
// 2026-09-19: asking the model took 34 s for four short paragraphs, with mistakes). Written syllables as taught at school,
// silent letters, groups of letters making one sound (« sons complexes », « sons amoureux »), letters that do not make their
// usual sound (c → s, g → j, s → z, t → s, x → gz / z) and liaisons. Rules of French spelling plus lists of exceptions; the
// text is never changed, each character only gets marks.

/** Letter written but not pronounced (grey). */
export const CODING_SILENT = 1;
/** Letter of a group of letters that makes one sound. */
export const CODING_SOUND = 2;
/** Every other sound group of a word, so that two groups side by side stay distinct. */
export const CODING_SOUND_ALT = 4;
/** Letter that does not make its usual sound. */
export const CODING_CHANGED = 8;

export interface TextCoding {
  /** Syllable number of each character inside its word (0, 1, 2…), -1 outside words. */
  syllable: Int16Array;
  /** CODING_* bits of each character. */
  flags: Uint8Array;
  /** Indexes of the spaces where a liaison is made (« les‿amis »). */
  liaisons: number[];
}

interface WordCoding { syllable: number[]; flags: number[]; group: number[] }

type UnitKind = 'V' | 'C' | 'G' | 'E' | 'T';
/** V vowel sound, C consonant, G glide (i, u before a vowel), E silent final e starting a written syllable, T silent end. */
interface Unit { start: number; end: number; kind: UnitKind }

const VOWELS = new Set([...'aeiouyàâäéèêëîïôöùûüœæ']);
const SOFTENERS = new Set([...'eiyéèêëîï']);
const STOPS = new Set(['b', 'c', 'd', 'f', 'g', 'k', 'p', 't', 'v', 'ch', 'ph', 'th', 'gu']);
const LIQUIDS = new Set(['l', 'r']);
const isVowel = (c: string | undefined): boolean => c !== undefined && VOWELS.has(c);

const words = (list: string): ReadonlySet<string> => new Set(list.split(/\s+/).filter(Boolean));

// ---------------------------------------------------------------- exceptions
/** Final s / x / z heard. */
const SOUNDED_S = words(`as bus autobus ours tennis cactus virus bonus campus iris oasis atlas maïs lys jadis hélas mars sens gratis express albatros
  rhinocéros cassis sinus prospectus terminus papyrus chorus blocus lotus eucalyptus humus rébus thermos bis tournevis vis myosotis
  hibiscus pancréas plexus fœtus index`);
const SOUNDED_X = words('index lynx silex larynx box fax thorax sphinx phénix relax latex pyrex onyx borax max lux');
const SOUNDED_Z = words('gaz quiz jazz fez oz blitz hertz');
const SOUNDED_T = words(`cet net brut chut zut dot mat rut scout internet kit set hit granit transit déficit mazout azimut bit tilt fat
  ticket basket`);
const SOUNDED_D = words('sud david bled raid stand lad yod caïd end');
const SOUNDED_P = words('cap cep stop top hop handicap clip slip ketchup hip cop flop pop rap scalp jeep gap croup');
const SOUNDED_G = words('gag grog zigzag iceberg bug blog gang erg whig gong ping pong bang boomerang');
/** Words ending in -er whose r is heard (mer, hiver…); plural stems included (vers → ver). */
const SOUNDED_ER = words(`mer fer ver fier hier cher amer hiver enfer super cancer laser hamster revolver poster cuiller éther bunker
  leader cracker poker starter scooter cutter reporter joker boxer roller hier tier enver traver univer rever diver perver`);
const SILENT_C = words('blanc banc franc tabac estomac porc flanc caoutchouc jonc tronc accroc croc escroc broc clerc marc ajonc raccroc');
const SILENT_L = words('gentil outil fusil sourcil nombril persil soûl saoul fournil coutil');
const SILENT_F = words('clef cerf nerf');
const SILENT_B = words('plomb aplomb');
/** Final -um heard as « omme » (album) and final -en heard as « ène » (examen). */
const UM_NOT_NASAL = words(`album maximum minimum forum aquarium podium rhum géranium sérum opium médium calcium sodium magnésium stadium
  auditorium référendum consortium optimum muséum`);
const EN_NOT_NASAL = words('examen pollen abdomen spécimen gluten dolmen lichen hymen cyclamen amen');
/** ll heard as l after i (ville), not as « ye » (fille). */
const ILL_AS_L = words(`ville villes mille milles tranquille tranquilles village villages villa villas million millions milliard milliards
  millier milliers lille distiller osciller pupille pupilles bacille bacilles cyrille`);
/** ch heard as k. */
const CH_AS_K = words(`chorale chorales chœur chœurs écho échos orchestre orchestres technique techniques chaos orchidée orchidées
  archéologie archéologue christophe christine chrétien chrétienne chrome chronique chronomètre psychologie psychologue
  yacht`);
/** h aspiré: no liaison before these words (les | héros). */
const H_ASPIRE = words(`hache haie haine haïr halte hamac hamburger hameau hamster hanche handicap hangar hanter harceler hardi hareng
  haricot harpe hasard hâte hausse haut haute hauteur hérisson héron héros hêtre hibou hiboux hiérarchie hisser hocher hockey homard
  honte honteux hoquet hors hotte houx hublot huer huit huitième hurler hutte hall halle hanneton hachis hachoir haillon harnais harpon
  havre héraut hobby houle housse huche hongrois hollandais hurlement hérisser heurter`);

/** Irregular words, in the notation of formatCoding (| syllable, {} silent, [] one sound, <> changed sound). */
const LEXICON_NOTATION = [
  'e{st}', 'se{p}t', 'se{p}|tiè|m{e}', 'c[om]{p}|te{r}', 'c[om]{p}|t{e}', 'c[om]{p}|t[oi]r', 'd[om]{p}|te{r}', 'ba{p}|tê|m{e}',
  'scul{p}|te{r}', 'scul{p}|tu|r{e}', 'f<e>m|m{e}', 'm<on>|si[eu]{r}', 'o{i}|[gn][on]', '{a}[oû]t', 'y[eu]{x}', '[œil]', 'fi{l}s',
  'p[ou]{ls}', '{h}uit', 'si<x>', 'di<x>', 'se|<c>[on]{d}', 'se|<c>[on]|d{e}', 'e<x>a|men', '[au]|j[ou]rd', 'al|bum', '[ou]i',
  '[œu]{fs}', 'b[œu]{fs}', 'p[oê]|l{e}', 'p[ay]{s}', 'pa|y<s>a|<g>{e}', '[<ch>]o|ra|l{e}', 'é|[<ch>]o', 'or|[<ch>]es|tr{e}',
  'te[<ch>]|ni|[qu]{e}', '[<ch>][œu]r', '[<ch>]a|os', 'or|[<ch>]i|dé{e}', 'vil|l{e}', 'mil|l{e}', 'tr[an]|[qu]il|l{e}',
  'vil|la|<g>{e}', 'mil|li[on]', 'mil|liar{d}', 'mil|lie{r}', 'vil|la', 'e{t}', 'a|vec', '[ch]e{f}|d[œu]|vr{e}',
];

interface LexiconEntry { syllable: number[]; flags: number[]; group: number[] }

/** Parses the notation of formatCoding for one word. */
function parseWordNotation(notation: string): { word: string; coding: LexiconEntry } {
  let word = '';
  const syllable: number[] = [];
  const flags: number[] = [];
  const group: number[] = [];
  let syl = 0;
  let silent = false;
  let changed = false;
  let sound = -1;
  let groups = 0;
  for (const ch of notation) {
    if (ch === '|') syl += 1;
    else if (ch === '{') silent = true;
    else if (ch === '}') silent = false;
    else if (ch === '<') changed = true;
    else if (ch === '>') changed = false;
    else if (ch === '[') sound = groups++;
    else if (ch === ']') sound = -1;
    else {
      word += ch;
      syllable.push(syl);
      flags.push((silent ? CODING_SILENT : 0) | (changed ? CODING_CHANGED : 0) | (sound >= 0 ? CODING_SOUND : 0));
      group.push(sound);
    }
  }
  return { word, coding: { syllable, flags, group } };
}

const LEXICON: ReadonlyMap<string, LexiconEntry> = new Map(LEXICON_NOTATION.map((n) => {
  const { word, coding } = parseWordNotation(n);
  return [word, coding];
}));

// ---------------------------------------------------------------- one word

/** A vowel before `pos` (the u of qu / gu does not count). */
function hasVowelBefore(w: string, pos: number): boolean {
  for (let i = 0; i < pos; i++) {
    if (!isVowel(w[i])) continue;
    if (w[i] === 'u' && (w[i - 1] === 'q' || w[i - 1] === 'g')) continue;
    return true;
  }
  return false;
}

/** Letters [result, end) are silent final consonants of `w.slice(0, end)`. */
function silentFinalConsonant(w: string, end: number): number {
  if (end < 2) return end;
  const stem = w.slice(0, end);
  const c = stem[end - 1];
  const before = stem[end - 2] ?? '';
  const quiet = isVowel(before) || before === 'n' || before === 'm' || before === 'r';
  switch (c) {
    case 't':
      if (stem.endsWith('gt')) return end - 2;
      return !SOUNDED_T.has(stem) && quiet ? end - 1 : end;
    case 'd':
      return !SOUNDED_D.has(stem) && quiet ? end - 1 : end;
    case 'p':
      return !SOUNDED_P.has(stem) && quiet ? end - 1 : end;
    case 'g':
      return !SOUNDED_G.has(stem) && !stem.endsWith('ing') && quiet ? end - 1 : end;
    case 'r':
      return stem.endsWith('er') && end > 2 && !SOUNDED_ER.has(stem) ? end - 1 : end;
    case 'c':
      return SILENT_C.has(stem) ? end - 1 : end;
    case 'l':
      return SILENT_L.has(stem) ? end - 1 : end;
    case 'f':
      return SILENT_F.has(stem) ? end - 1 : end;
    case 'b':
      return SILENT_B.has(stem) ? end - 1 : end;
    case 'h':
      return end - 1;
    default:
      return end;
  }
}

/** Start of the silent end of the word (ils mang|ent, table|s, enfan|ts, pomm|e). */
function silentTailStart(w: string, verb3pl: boolean): number {
  const n = w.length;
  if (n > 5 && w.endsWith('aient')) return n - 3;
  if (n > 3 && verb3pl && w.endsWith('ent')) return n - 3;
  let end = n;
  const last = w[n - 1];
  if ((last === 's' && !SOUNDED_S.has(w)) || (last === 'x' && !SOUNDED_X.has(w)) || (last === 'z' && !SOUNDED_Z.has(w))) end -= 1;
  if (end >= 2 && w[end - 1] === 'e' && hasVowelBefore(w, end - 1)) return end - 1;
  return silentFinalConsonant(w, end);
}

function startsAt(w: string, i: number, pattern: string): boolean {
  return w.startsWith(pattern, i);
}

/**
 * The n / m after the vowel at `i` makes a nasal sound (an, on, in…): at the end of the word, before a consonant but not
 * before the same doubled letter; m only before b / p or at the end of what is heard (nom, noms).
 */
function isNasal(w: string, i: number, letter: string, end: number): boolean {
  const after = i + 2;
  if (after >= w.length) return true;
  const next = w[after];
  if (isVowel(next)) return false;
  if (letter === 'n') return next !== 'n';
  return next === 'b' || next === 'p' || after >= end;
}

function analyzeWord(w: string, opts: { verb3pl: boolean; elided: boolean }): WordCoding {
  const n = w.length;
  const lex = LEXICON.get(w);
  if (lex) return { syllable: [...lex.syllable], flags: [...lex.flags], group: [...lex.group] };
  // Plural of an irregular word: villes, femmes.
  const stem = n > 2 && (w.endsWith('s') || w.endsWith('x')) ? LEXICON.get(w.slice(0, -1)) : undefined;
  if (stem) {
    const last = stem.syllable[stem.syllable.length - 1] ?? 0;
    return { syllable: [...stem.syllable, last], flags: [...stem.flags, CODING_SILENT], group: [...stem.group, -1] };
  }

  const flags = new Array<number>(n).fill(0);
  const group = new Array<number>(n).fill(-1);
  const mark = (k: number, bit: number): void => {
    flags[k] = (flags[k] ?? 0) | bit;
  };
  const end = opts.elided ? n : silentTailStart(w, opts.verb3pl);
  for (let i = end; i < n; i++) mark(i, CODING_SILENT);

  const units: Unit[] = [];
  let groups = 0;
  const sound = (from: number, to: number): void => {
    for (let k = from; k < to; k++) {
      mark(k, CODING_SOUND);
      group[k] = groups;
    }
    groups += 1;
  };
  const unit = (start: number, len: number, kind: UnitKind): void => {
    units.push({ start, end: start + len, kind });
  };

  let i = 0;
  while (i < end) {
    const c = w[i] as string;
    const next = w[i + 1];

    // vowel + ill / final il: paille, abeille, feuille, grenouille, cueillir; travail, soleil, fauteuil
    const glide = ['ueill', 'ouill', 'euill', 'aill', 'eill'].find((p) => startsAt(w, i, p) && isVowel(w[i + p.length]));
    if (glide) {
      sound(i, i + glide.length);
      unit(i, glide.length - 1, 'V');
      unit(i + glide.length - 1, 1, 'C');
      i += glide.length;
      continue;
    }
    const finalIl = ['ueil', 'ouil', 'euil', 'ail', 'eil'].find((p) => startsAt(w, i, p) && i + p.length === end && !w.slice(end).includes('e'));
    if (finalIl) {
      sound(i, i + finalIl.length);
      unit(i, finalIl.length, 'V');
      i += finalIl.length;
      continue;
    }
    if (startsAt(w, i, 'eau')) {
      sound(i, i + 3);
      unit(i, 3, 'V');
      i += 3;
      continue;
    }
    const nasal3 = ['ain', 'aim', 'ein', 'eim', 'oin'].find((p) => startsAt(w, i, p) && isNasal(w, i + 1, p[2] as string, end));
    if (nasal3) {
      sound(i, i + 3);
      unit(i, 3, 'V');
      i += 3;
      continue;
    }
    if (startsAt(w, i, 'oeu') || startsAt(w, i, 'œu')) {
      const len = c === 'œ' ? 2 : 3;
      sound(i, i + len);
      unit(i, len, 'V');
      i += len;
      continue;
    }
    if ('aeiouy'.includes(c) && (next === 'n' || next === 'm')) {
      const startDouble = i === 0 && c === 'e' && w[2] === next;   // ennui, emmener
      const exception = (next === 'm' && c === 'u' && UM_NOT_NASAL.has(w) && i === n - 2)
        || (next === 'n' && c === 'e' && EN_NOT_NASAL.has(w) && i === n - 2);
      if (!exception && (startDouble || isNasal(w, i, next, end))) {
        sound(i, i + 2);
        unit(i, 2, 'V');
        i += 2;
        continue;
      }
    }
    const vowelPair = ['ou', 'oû', 'où', 'oi', 'oî', 'ai', 'aî', 'ei', 'au', 'eu', 'eû'].find((p) => startsAt(w, i, p));
    if (vowelPair) {
      sound(i, i + 2);
      unit(i, 2, 'V');
      i += 2;
      continue;
    }
    if (c === 'c' && next === 'h') {
      sound(i, i + 2);
      if (w[i + 2] === 'r' || w[i + 2] === 'l' || CH_AS_K.has(w)) {
        mark(i, CODING_CHANGED);
        mark(i + 1, CODING_CHANGED);
      }
      unit(i, 2, 'C');
      i += 2;
      continue;
    }
    if ((c === 'p' || c === 't' || c === 's') && next === 'h') {
      sound(i, i + 2);
      unit(i, 2, 'C');
      i += 2;
      continue;
    }
    if (c === 'g' && next === 'n') {
      sound(i, i + 2);
      unit(i, 2, 'C');
      i += 2;
      continue;
    }
    if ((c === 'q' && next === 'u') || (c === 'g' && next === 'u' && SOFTENERS.has(w[i + 2] ?? ''))) {
      sound(i, i + 2);
      unit(i, 2, 'C');
      i += 2;
      continue;
    }
    if (c === 's' && next === 'c' && SOFTENERS.has(w[i + 2] ?? '')) {
      // piscine: one sound, but the written syllables are cut between s and c (pis|ci|ne).
      sound(i, i + 2);
      unit(i, 1, 'C');
      unit(i + 1, 1, 'C');
      i += 2;
      continue;
    }
    if (c === 'i' && startsAt(w, i, 'ill') && i > 0 && !ILL_AS_L.has(w)) {
      const prev = w[i - 1];
      const afterConsonant = !isVowel(prev) || (prev === 'u' && (w[i - 2] === 'q' || w[i - 2] === 'g'));
      if (afterConsonant) {
        sound(i, i + 3);
        unit(i, 1, 'V');
        unit(i + 1, 1, 'C');
        unit(i + 2, 1, 'C');
        i += 3;
        continue;
      }
    }
    if (c === 'h') {
      mark(i, CODING_SILENT);
      unit(i, 1, 'C');
      i += 1;
      continue;
    }
    if (isVowel(c)) {
      if (c === 'y' && ((i === 0 && isVowel(next)) || (i > 0 && isVowel(w[i - 1]) && isVowel(next)))) {
        unit(i, 1, 'C');
      } else if ((c === 'i' && isVowel(next) && !(i >= 2 && LIQUIDS.has(w[i - 1] ?? '') && STOPS.has(w[i - 2] ?? '')))
        || (c === 'u' && next === 'i')) {
        unit(i, 1, 'G');
      } else {
        unit(i, 1, 'V');
      }
      i += 1;
      continue;
    }
    // single consonant
    let len = 1;
    if ((c === 'c' || c === 'g') && SOFTENERS.has(next ?? '')) {
      mark(i, CODING_CHANGED);
      // mangeons, pigeon: the e only softens the g.
      if (c === 'g' && next === 'e' && 'aouâôû'.includes(w[i + 2] ?? '#') && i + 2 < end) {
        mark(i + 1, CODING_SILENT);
        len = 2;
      }
    } else if (c === 's' && i > 0 && isVowel(w[i - 1]) && isVowel(next)) {
      mark(i, CODING_CHANGED);
    } else if (c === 't' && w[i - 1] !== 's' && w[i - 1] !== 'x'
      && (['tion', 'tial', 'tiel', 'tieux', 'tieuse', 'tience', 'tiaire'].some((p) => startsAt(w, i, p))
        || ((w.slice(i) === 'tie' || w.slice(i) === 'ties') && isVowel(w[i - 1])))) {
      mark(i, CODING_CHANGED);
    } else if (c === 'x' && ((i === 1 && w[0] === 'e' && isVowel(next)) || w.startsWith('ième', i + 1))) {
      mark(i, CODING_CHANGED);
    }
    unit(i, len, 'C');
    i += len;
  }

  // Silent end: a written syllable of its own after a consonant (pom|me, man|gent), else part of the last one (joie).
  if (end < n) {
    const last = units[units.length - 1];
    units.push({ start: end, end: n, kind: w[end] === 'e' && last?.kind === 'C' ? 'E' : 'T' });
  }

  const syllable = syllabify(w, units, n);
  return { syllable, flags, group };
}

/** Written syllables: V|CV, VC|CV, V|CCV when the consonants cannot be separated (bl, tr…), glides go with the next vowel. */
function syllabify(w: string, units: readonly Unit[], n: number): number[] {
  const syllable = new Array<number>(n).fill(0);
  const nuclei: number[] = [];
  units.forEach((u, index) => {
    if (u.kind === 'V' || u.kind === 'E') nuclei.push(index);
  });
  const starts: number[] = [];
  for (let k = 0; k + 1 < nuclei.length; k++) {
    const a = nuclei[k] as number;
    const b = nuclei[k + 1] as number;
    let j = b;
    while (j - 1 > a && units[j - 1]?.kind === 'G') j -= 1;
    const consonants = j - (a + 1);
    let split: number;
    if (consonants <= 0) split = j;
    else if (consonants === 1) split = a + 1;
    else {
      const c1 = units[j - 2] as Unit;
      const c2 = units[j - 1] as Unit;
      const t1 = w.slice(c1.start, c1.end).replace(/[^a-zç]/g, '');
      const t2 = w.slice(c2.start, c2.end);
      split = LIQUIDS.has(t2) && STOPS.has(t1) ? j - 2 : j - 1;
    }
    starts.push(split);
  }
  let s = 0;
  units.forEach((u, index) => {
    while (s < starts.length && (starts[s] as number) <= index) s += 1;
    for (let k = u.start; k < u.end; k++) syllable[k] = s;
  });
  return syllable;
}

// ---------------------------------------------------------------- text

interface Token { start: number; end: number; lower: string }

const LETTERS = /[\p{L}\p{M}]+/gu;
const CLITICS = words('ne n se s le la l les lui leur y en me m te t nous vous');
const SUBJECTS = words('ils elles');
const PLURAL_DETERMINERS = words('les des mes tes ses ces nos vos leurs aux plusieurs quelques certains certaines deux trois quatre cinq six sept huit neuf dix tous toutes');
const LIAISON_ALWAYS = words('les des mes tes ses ces nos vos leurs aux un aucun mon ton son quels quelles quelques plusieurs certains certaines deux trois six dix vingt cent cet');
const LIAISON_WORDS = words('nous vous ils elles on en dans chez sans sous très plus quand dont tout');
const LIAISON_ADJECTIVES = words(`petit petits petites grand grands grandes gros bon bons bonnes beaux belles premier premiers premières dernier
  derniers dernières mauvais vieux jolis jolies autres nouveaux nouvelles anciens anciennes longs faux vrais`);
const NO_LIAISON_NEXT = words('et ou où à au aux avec alors après avant ainsi aussi oui onze onzième ici');
const NOT_AFTER_ADJECTIVE = words('est a ai as avait était ont avaient étaient en il elle ils elles on y');

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(LETTERS)) {
    const start = m.index ?? 0;
    const value = m[0];
    const lower = value.toLowerCase();
    if (lower.length !== value.length) continue;
    tokens.push({ start, end: start + value.length, lower });
  }
  return tokens;
}

const isSentenceBreak = (sep: string): boolean => /[.;:!?«»()[\]—–"]/u.test(sep);

/** « ils mangent », « les enfants jouent », « les amis qui arrivent »: the final -ent is a silent verb ending. */
function isVerb3pl(text: string, tokens: readonly Token[], k: number): boolean {
  let j = k - 1;
  let steps = 0;
  while (j >= 0 && steps < 4) {
    const sep = text.slice((tokens[j] as Token).end, (tokens[j + 1] as Token).start);
    if (isSentenceBreak(sep)) return false;
    const t = (tokens[j] as Token).lower;
    if (SUBJECTS.has(t)) return true;
    if (CLITICS.has(t)) {
      j -= 1;
      steps += 1;
      continue;
    }
    if (t === 'qui') return true;
    // plural noun (and adjectives) after a plural determiner
    let p = j;
    let hops = 0;
    while (p >= 0 && hops < 3 && /[sx]$/.test((tokens[p] as Token).lower)) {
      const prev = tokens[p - 1];
      if (!prev) break;
      if (isSentenceBreak(text.slice(prev.end, (tokens[p] as Token).start))) break;
      if (PLURAL_DETERMINERS.has(prev.lower)) return true;
      p -= 1;
      hops += 1;
    }
    return false;
  }
  return false;
}

function startsWithVowelSound(word: string): boolean {
  const first = word[0];
  if (first === undefined) return false;
  if (first === 'y') return word === 'yeux' || !isVowel(word[1]);
  if (first === 'h') {
    const bare = word.replace(/[sx]$/, '');
    return !H_ASPIRE.has(word) && !H_ASPIRE.has(bare);
  }
  return isVowel(first);
}

function isLiaison(text: string, tokens: readonly Token[], k: number): boolean {
  const a = tokens[k] as Token;
  const b = tokens[k + 1] as Token;
  if (text.slice(a.end, b.start) !== ' ') return false;
  const w2 = b.lower;
  if (!startsWithVowelSound(w2)) return false;
  const w1 = a.lower;
  if (w1 === 'est') {
    const prev = tokens[k - 1];
    return prev?.lower === 'c' && /^['’]$/.test(text.slice(prev.end, a.start)) && w2 !== 'et' && w2 !== 'ou';
  }
  if (LIAISON_ALWAYS.has(w1)) return true;
  if (w1 === 'tout') return w2 !== 'et' && w2 !== 'ou';
  if (LIAISON_WORDS.has(w1)) return !NO_LIAISON_NEXT.has(w2);
  if (LIAISON_ADJECTIVES.has(w1)) return !NO_LIAISON_NEXT.has(w2) && !NOT_AFTER_ADJECTIVE.has(w2);
  return false;
}

/** Codes a French text (one block). Never throws; words it cannot read stay without marks. */
export function codeFrenchText(text: string): TextCoding {
  const n = text.length;
  const syllable = new Int16Array(n).fill(-1);
  const flags = new Uint8Array(n);
  const liaisons: number[] = [];
  const tokens = tokenize(text);
  tokens.forEach((t, k) => {
    try {
      const elided = /^['’]/.test(text.slice(t.end, t.end + 1)) && tokens[k + 1]?.start === t.end + 1;
      const verb3pl = t.lower.endsWith('ent') && isVerb3pl(text, tokens, k);
      const coded = analyzeWord(t.lower, { verb3pl, elided });
      for (let i = 0; i < t.end - t.start; i++) {
        const g = coded.group[i] ?? -1;
        syllable[t.start + i] = coded.syllable[i] ?? 0;
        flags[t.start + i] = (coded.flags[i] ?? 0) | (g >= 0 && g % 2 === 1 ? CODING_SOUND_ALT : 0);
      }
      if (k + 1 < tokens.length && isLiaison(text, tokens, k)) liaisons.push(t.end);
    } catch {
      // A word the rules do not handle stays plain.
    }
  });
  return { syllable, flags, liaisons };
}

const cache = new Map<string, TextCoding>();

/** codeFrenchText with a cache (the reader codes the same blocks again and again). */
export function codeFrenchTextCached(text: string): TextCoding {
  let coding = cache.get(text);
  if (!coding) {
    coding = codeFrenchText(text);
    if (cache.size > 2000) cache.clear();
    cache.set(text, coding);
  }
  return coding;
}

/**
 * Readable form of a coding (tests, diagnostics): « | » between syllables, { } silent letters, [ ] one sound, < > changed
 * sound, ‿ liaison.
 */
export function formatCoding(text: string, coding: TextCoding): string {
  const liaisons = new Set(coding.liaisons);
  const openers = ['[', '<', '{'];
  const closers = [']', '>', '}'];
  const state = ['', '', ''];
  let out = '';
  const closeFrom = (level: number): void => {
    for (let k = 2; k >= level; k--) {
      if (state[k]) out += closers[k];
      state[k] = '';
    }
  };
  for (let i = 0; i < text.length; i++) {
    const f = coding.flags[i] ?? 0;
    const inWord = (coding.syllable[i] ?? -1) >= 0;
    const sameWord = inWord && i > 0 && (coding.syllable[i - 1] ?? -1) >= 0;
    const desired = inWord
      ? [f & CODING_SOUND ? (f & CODING_SOUND_ALT ? 'b' : 'a') : '', f & CODING_CHANGED ? 'c' : '', f & CODING_SILENT ? 's' : '']
      : ['', '', ''];
    let level = 0;
    if (sameWord) while (level < 3 && desired[level] === state[level]) level += 1;
    closeFrom(level);
    if (sameWord && coding.syllable[i] !== coding.syllable[i - 1]) out += '|';
    for (let k = level; k < 3; k++) {
      if (desired[k]) out += openers[k];
      state[k] = desired[k] as string;
    }
    out += liaisons.has(i) ? '‿' : text[i];
  }
  closeFrom(0);
  return out;
}
