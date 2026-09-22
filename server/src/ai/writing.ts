// §24 « Corriger »: a correction of the child's own text must keep it (same lines, the same words written better) and the
// adult sees what changed. Both are decided here, never trusted from the model.
import type { WritingChange, WritingChangeKind } from '@aide/shared';

/** Largest share of the letters of a group of words that may change; words written by ear are recognised by their sound. */
export const WRITING_GROUP_MAX_RATIO = 0.4;
/** A group may always change this many letters (« ne » added to a negation, « plusiers » → « plusieurs »). */
export const WRITING_GROUP_FREE_EDITS = 2;
/** Largest share of the letters of the whole text that may change. */
export const WRITING_TEXT_MAX_RATIO = 0.4;
export const WRITING_RULE_MAX_CHARS = 140;

const INJECTION_MARKS_RE = /[⟦⟧]/g;

/** Letters and digits without accents nor case: what a correction must (almost) keep. */
export function lettersOf(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Letters with their accents, lowercased (accents and grammatical endings). */
function accentedLetters(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost));
    }
    previous = current;
  }
  return previous[b.length]!;
}

// Rough French sound key: spellings of the same sound get the same letter, silent letters go. Enough to recognise a word
// written by ear (« fé » / « fait », « kan » / « quand ») without accepting another word (« chat » / « chien »).
const SOUND_RULES: [RegExp, string][] = [
  [/[^a-zàâäéèêëîïôöûùüçœæ]/g, ''],
  [/œ/g, 'e'], [/æ/g, 'e'],
  [/(eaux|eau|aux|au|ô)/g, 'o'],
  [/ph/g, 'f'],
  [/(qu|ck|q)/g, 'k'],
  [/g(?=[eéèêiîy])/g, 'j'], [/gu(?=[eéèêiîy])/g, 'g'],
  [/c(?=[eéèêiîy])/g, 's'], [/ç/g, 's'], [/sch/g, 'S'], [/ch/g, 'S'], [/c/g, 'k'],
  [/(ain|ein|aim|in|im|un|um|yn)(?![aeiouyéèêàâîôûmn])/g, '1'],
  [/(an|am|en|em)(?![aeiouyéèêàâîôûmn])/g, '2'],
  [/(on|om)(?![aeiouyéèêàâîôûmn])/g, '3'],
  [/ou|où|oû/g, 'u'], [/oi/g, 'w'],
  [/(ai|ei|è|ê|ë|é)/g, 'E'],
  [/est$/g, 'E'],
  [/(et|er|ez|es)$/g, 'E'],
  [/y/g, 'i'], [/[îï]/g, 'i'], [/[àâä]/g, 'a'], [/[ûùü]/g, 'u'], [/ö/g, 'o'],
  [/h/g, ''],
  [/z/g, 's'],
  [/(.)\1+/g, '$1'],
  [/([^aeiouEw123])(e|s|t|d|x|p)$/g, '$1'],
  [/[stdxp]$/g, ''],
  [/e$/g, ''],
];

/** Word by word (an apostrophe joins: « c'est » sounds like « sé »). */
export function soundKey(text: string): string {
  return text.split(/\s+/).map((word) => {
    let s = word.normalize('NFC').toLowerCase();
    for (const [pattern, replacement] of SOUND_RULES) s = s.replace(pattern, replacement);
    return s;
  }).join('');
}

function tokens(line: string): string[] {
  return line.split(/\s+/).filter((t) => t !== '');
}

/** Pairs of runs of words that differ, found with the longest common subsequence of identical words. */
function differingRuns(from: readonly string[], to: readonly string[]): [string[], string[]][] {
  const n = from.length;
  const m = to.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = from[i] === to[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const runs: [string[], string[]][] = [];
  let a: string[] = [];
  let b: string[] = [];
  const flush = (): void => {
    if (a.length > 0 || b.length > 0) runs.push([a, b]);
    a = [];
    b = [];
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && from[i] === to[j]) {
      flush();
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      a.push(from[i]!);
      i++;
    } else {
      b.push(to[j]!);
      j++;
    }
  }
  flush();
  return runs;
}

/**
 * Splits a run into groups: words written together or apart (« jevais » → « Je vais », « l ia » → « l'IA ») are grouped
 * when their letters match, words replaced one by one are paired, the rest stays one group.
 */
function groupsOf(from: readonly string[], to: readonly string[]): [string[], string[]][] {
  const groups: [string[], string[]][] = [];
  let i = 0;
  let j = 0;
  outer: while (i < from.length && j < to.length) {
    for (let size = 2; size <= 6; size++) {
      for (let di = 1; di <= Math.min(3, size - 1); di++) {
        const dj = size - di;
        if (dj > 3 || i + di > from.length || j + dj > to.length) continue;
        const a = from.slice(i, i + di);
        const b = to.slice(j, j + dj);
        if (lettersOf(a.join('')) === lettersOf(b.join('')) && lettersOf(a.join('')) !== '') {
          groups.push([a, b]);
          i += di;
          j += dj;
          continue outer;
        }
      }
    }
    if (from.length - i === to.length - j) {
      groups.push([[from[i]!], [to[j]!]]);
      i++;
      j++;
      continue;
    }
    groups.push([from.slice(i), to.slice(j)]);
    i = from.length;
    j = to.length;
  }
  if (i < from.length) groups.push([from.slice(i), []]);
  if (j < to.length) groups.push([[], to.slice(j)]);
  return groups;
}

const GRAMMAR_ENDINGS = new Set([
  '', 's', 'x', 'e', 'es', 't', 'nt', 'ent', 'r', 'er', 'é', 'ée', 'és', 'ées', 'ez', 'ai', 'ais', 'ait', 'aient', 'a', 'as', 'ont', 'ons', 'd',
  'al', 'als', 'aux', 'ail', 'ails',
]);

/** Only the end of the word changed, from one grammatical ending to another (« ligne » → « lignes », « cheval » → « chevaux »). */
function onlyEndingChanged(from: string, to: string): boolean {
  const a = accentedLetters(from);
  const b = accentedLetters(to);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  for (let k = common; k >= 2; k--) {
    if (GRAMMAR_ENDINGS.has(a.slice(k)) && GRAMMAR_ENDINGS.has(b.slice(k))) return true;
  }
  return false;
}

/**
 * Conjugated forms of « être » and « avoir »: the two words French builds its compound tenses with.
 *
 * A child who writes « je suis été » or « j'ai allé » has not misspelled anything. They picked the wrong auxiliary,
 * and no amount of letter-level tolerance will ever let that correction through, because « suis » and « ai » share
 * almost nothing. So this one substitution is named, and allowed on its own terms.
 */
const AUXILIARIES = new Set([
  // être
  'suis', 'es', 'est', 'sommes', 'êtes', 'sont', 'étais', 'était', 'étions', 'étiez', 'étaient',
  'serai', 'seras', 'sera', 'serons', 'serez', 'seront', 'serais', 'serait', 'serions', 'seriez', 'seraient',
  'fus', 'fut', 'fûmes', 'fûtes', 'furent', 'sois', 'soit', 'soyons', 'soyez', 'soient', 'être', 'étant',
  // avoir
  'ai', 'as', 'a', 'avons', 'avez', 'ont', 'avais', 'avait', 'avions', 'aviez', 'avaient',
  'aurai', 'auras', 'aura', 'aurons', 'aurez', 'auront', 'aurais', 'aurait', 'aurions', 'auriez', 'auraient',
  'eus', 'eut', 'eûmes', 'eûtes', 'eurent', 'aie', 'aies', 'ait', 'ayons', 'ayez', 'aient', 'avoir', 'ayant',
]);

/** Words that only hold a sentence together, and what an elision leaves of them (« j'ai » → « j » + « ai »). */
const PARTICLES = new Set([
  'je', 'j', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'ne', 'n', 'me', 'm', 'te', 't', 'se', 's', 'y', 'en', 'que', 'qu', 'c', 'ç', 'd', 'l',
]);

/** Endings of French past participles. */
const PARTICIPLE_ENDINGS = ['é', 'ée', 'és', 'ées', 'i', 'ie', 'is', 'ies', 'it', 'u', 'ue', 'us', 'ues'];
/** The ones that end in a consonant and would be missed by the endings above. */
const IRREGULAR_PARTICIPLES = new Set(['ouvert', 'offert', 'souffert', 'couvert', 'découvert', 'mort', 'craint', 'peint', 'joint', 'atteint']);

/** Lowercased words, elisions split apart, punctuation gone. */
function simplifiedWords(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .split(/\s+/)
    .flatMap((word) => word.split(/['’]/))
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word !== '');
}

function looksLikeParticiple(word: string): boolean {
  if (IRREGULAR_PARTICIPLES.has(word)) return true;
  return word.length >= 2 && PARTICIPLE_ENDINGS.some((ending) => word.endsWith(ending));
}

/** Whether the word after this auxiliary, in the corrected line, is a past participle — i.e. a compound tense. */
function inCompoundTense(auxiliary: string, correctedLine: string): boolean {
  const words = simplifiedWords(correctedLine).filter((word) => !PARTICLES.has(word));
  return words.some((word, index) => word === auxiliary && looksLikeParticiple(words[index + 1] ?? ''));
}

/**
 * Whether the only real change is one auxiliary put in place of the other, inside a compound tense.
 *
 * The participle is what keeps the guard on everything else. It usually sits outside the group — the words that did
 * not change are not in it — so the corrected line is read to find it: « il a tombé » → « il est tombé » goes
 * through because « tombé » follows, while « il a le livre » → « il est le livre » is refused because « le » does
 * not. The sentence the child built is corrected; the sentence they meant is left alone.
 */
export function auxiliarySwap(from: string, to: string, correctedLine: string = to): boolean {
  const a = simplifiedWords(from).filter((word) => !PARTICLES.has(word));
  const b = simplifiedWords(to).filter((word) => !PARTICLES.has(word));
  if (a.length === 0 || a.length !== b.length) return false;

  let swapped = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (!AUXILIARIES.has(a[i]!) || !AUXILIARIES.has(b[i]!)) return false;
    if (!inCompoundTense(b[i]!, correctedLine)) return false;
    swapped = true;
  }
  return swapped;
}

export function classifyChange(from: string, to: string, correctedLine: string = to): WritingChangeKind {
  const lettersFrom = lettersOf(from);
  const lettersTo = lettersOf(to);
  if (from === '' || to === '') return lettersFrom === '' && lettersTo === '' ? 'ponctuation' : 'grammaire';
  if (lettersFrom === lettersTo) {
    if (accentedLetters(from) !== accentedLetters(to)) return 'accent';
    if (tokens(from).length !== tokens(to).length) return 'espace';
    const punctuation = (t: string): string => t.normalize('NFC').replace(/[\p{L}\p{N}\s]/gu, '');
    if (punctuation(from) !== punctuation(to)) return 'ponctuation';
    return 'majuscule';
  }
  if (auxiliarySwap(from, to, correctedLine)) return 'construction';
  if (tokens(from).length === 1 && tokens(to).length === 1 && onlyEndingChanged(from, to)) return 'grammaire';
  return 'orthographe';
}

export interface WritingNote {
  from: string;
  to: string;
  rule: string;
}

/** Model explanation of a change: a note about the same words, else the smallest note about a passage of the same line. */
function ruleFor(change: { from: string; to: string }, line: string, allNotes: readonly WritingNote[]): string | null {
  const lineLetters = lettersOf(line);
  const notes = allNotes.filter((n) => lineLetters.includes(lettersOf(n.from)));
  const from = lettersOf(change.from);
  const to = lettersOf(change.to);
  const found = notes.find((n) => lettersOf(n.from) === from && lettersOf(n.to) === to && n.from.trim() !== '')
    ?? notes.find((n) => {
      const nf = lettersOf(n.from);
      const nt = lettersOf(n.to);
      if (nf === '' && nt === '') return n.to.trim() !== '' && change.to.includes(n.to.trim()) && change.from.includes(n.from.trim());
      return nf !== '' && from.includes(nf) && to.includes(nt);
    })
    // A note about a longer passage that contains the change (the smallest one: the most precise).
    ?? [...notes]
      .sort((a, b) => a.from.length - b.from.length)
      .find((n) => from !== '' && lettersOf(n.from).includes(from) && lettersOf(n.to).includes(to));
  const rule = found?.rule.replace(/\s+/g, ' ').trim() ?? '';
  return rule === '' ? null : rule.slice(0, WRITING_RULE_MAX_CHARS);
}

/** What changed, line by line (0-based line numbers), with the model's short explanation when one matches. */
export function writingChanges(originalLines: readonly string[], correctedLines: readonly string[], notes: readonly WritingNote[] = []): WritingChange[] {
  const changes: WritingChange[] = [];
  originalLines.forEach((line, index) => {
    const corrected = correctedLines[index] ?? '';
    for (const [a, b] of differingRuns(tokens(line), tokens(corrected))) {
      for (const [from, to] of groupsOf(a, b)) {
        const change = { from: from.join(' '), to: to.join(' ') };
        if (change.from === change.to) continue;
        changes.push({ line: index, ...change, kind: classifyChange(change.from, change.to, corrected), rule: ruleFor(change, line, notes) });
      }
    }
  });
  return changes;
}

export type WritingProblem =
  | { code: 'line_count'; expected: number; got: number }
  | { code: 'blank_line'; line: number; blank: boolean }
  | { code: 'group_changed'; line: number; from: string; to: string }
  | { code: 'text_changed' };

export interface WritingCheck {
  /** Corrected lines with the spaces around each line of the child kept. */
  lines: string[];
  problems: WritingProblem[];
}

/** Too many letters changed, and not the same words said aloud either. */
function tooDifferent(from: string, to: string, maxRatio: number): boolean {
  const a = lettersOf(from);
  const b = lettersOf(to);
  const distance = levenshtein(a, b);
  // A short word may not become another short word (« un » → « le »); a small word may be added or removed (« ne »).
  const free = a === '' || b === '' ? WRITING_GROUP_FREE_EDITS : Math.min(WRITING_GROUP_FREE_EDITS, Math.floor(Math.max(a.length, b.length) / 2));
  if (distance <= free || distance / Math.max(a.length, b.length, 1) <= maxRatio) return false;
  const soundA = soundKey(from);
  const soundB = soundKey(to);
  const soundDistance = levenshtein(soundA, soundB);
  return soundDistance > Math.max(soundA.length, soundB.length) * 0.2;
}

/**
 * The correction keeps the child's text: the same number of lines, empty lines still empty (and the others not), each group of
 * words close to the child's words, and the whole text close to it. The spaces before and after each line are the child's.
 */
export function checkWritingCorrection(original: string, modelLines: readonly string[]): WritingCheck {
  const originalLines = original.split('\n');
  const problems: WritingProblem[] = [];
  if (modelLines.length !== originalLines.length) {
    return { lines: [], problems: [{ code: 'line_count', expected: originalLines.length, got: modelLines.length }] };
  }
  const lines = originalLines.map((line, index) => {
    const content = (modelLines[index] ?? '').replace(INJECTION_MARKS_RE, '').replace(/\s+/g, (s) => (s.includes('\n') ? ' ' : s)).trim();
    const blank = line.trim() === '';
    if (blank !== (content === '')) problems.push({ code: 'blank_line', line: index, blank });
    if (blank) return line;
    const leading = /^\s*/.exec(line)?.[0] ?? '';
    const trailing = /\s*$/.exec(line)?.[0] ?? '';
    return `${leading}${content}${trailing}`;
  });
  if (problems.length > 0) return { lines, problems };
  lines.forEach((line, index) => {
    for (const [a, b] of differingRuns(tokens(originalLines[index]!), tokens(line))) {
      for (const [from, to] of groupsOf(a, b)) {
        const before = from.join(' ');
        const after = to.join(' ');
        // One auxiliary for the other is a change of construction, not a change of words: it never passes the
        // letter budget and it is exactly what a child gets wrong. Everything else keeps its guard.
        if (!auxiliarySwap(before, after, line) && tooDifferent(before, after, WRITING_GROUP_MAX_RATIO)) {
          problems.push({ code: 'group_changed', line: index, from: before, to: after });
        }
      }
    }
  });
  if (tooDifferent(original, lines.join('\n'), WRITING_TEXT_MAX_RATIO)) problems.push({ code: 'text_changed' });
  return { lines, problems };
}
