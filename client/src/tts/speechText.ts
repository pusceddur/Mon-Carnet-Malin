// Text given to the speech synthesizer: French abbreviations and roman numerals said in words, OCR noise removed,
// with a map back to the displayed text so that word highlighting stays on the right word.
import { alignSpokenText } from '@aide/shared';

export interface SpokenText {
  /** What the voice reads. */
  text: string;
  /** Index in the displayed text of the character at `spokenIndex`. */
  toSource(spokenIndex: number): number;
}

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS: Record<number, string> = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' };

/** French cardinal in words (0..999), 1990 spelling with hyphens. */
export function frenchCardinal(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  if (n <= 16) return UNITS[n]!;
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  if (n < 70) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return TENS[t]!;
    return u === 1 ? `${TENS[t]} et un` : `${TENS[t]}-${UNITS[u]}`;
  }
  if (n < 80) return n === 71 ? 'soixante et onze' : `soixante-${frenchCardinal(n - 60)}`;
  if (n < 100) return n === 80 ? 'quatre-vingts' : `quatre-vingt-${frenchCardinal(n - 80)}`;
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const hundreds = h === 1 ? 'cent' : `${UNITS[h]} cent${rest === 0 ? 's' : ''}`;
  return rest === 0 ? hundreds : `${hundreds} ${frenchCardinal(rest)}`;
}

/** French ordinal in words: 1 → premier / première, 19 → dix-neuvième, 21 → vingt et unième. */
export function frenchOrdinal(n: number, feminine = false): string {
  if (n === 1) return feminine ? 'première' : 'premier';
  const cardinal = frenchCardinal(n);
  if (cardinal.endsWith('cinq')) return `${cardinal}uième`;
  if (cardinal.endsWith('neuf')) return `${cardinal.slice(0, -1)}vième`;
  if (cardinal.endsWith('quatre-vingts')) return `${cardinal.slice(0, -1)}ième`;
  if (cardinal.endsWith('cents')) return `${cardinal.slice(0, -1)}ième`;
  if (cardinal.endsWith('e')) return `${cardinal.slice(0, -1)}ième`;
  return `${cardinal}ième`;
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/** Value of a well-formed roman numeral (I..MMM), null otherwise. */
export function romanToInt(roman: string): number | null {
  if (!/^[IVXLCDM]+$/.test(roman)) return null;
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const value = ROMAN[roman[i]!]!;
    const next = ROMAN[roman[i + 1] ?? ''] ?? 0;
    total += value < next ? -value : value;
  }
  const canonical = intToRoman(total);
  return canonical === roman ? total : null;
}

function intToRoman(n: number): string {
  const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  let rest = n;
  for (const [value, symbol] of table) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

interface Rule {
  pattern: RegExp;
  replace(match: RegExpExecArray): string | null;
}

const UPPER_NEXT = String.raw`(?=[\s  -]+\p{Lu})`;

const RULES: Rule[] = [
  // §22 list marker opening what is read (« 1: », « 2) », « a) »): « 1. », the voice pauses before the item. « 1. » is
  // already right, and « M. » must stay free for « Monsieur ».
  { pattern: /^(\d{1,3}|[A-Za-z])[^\S\n]?[):](?=[^\S\n]*\S)/gu, replace: (m) => `${m[1]}.` },
  // Era markers first (they contain dots).
  { pattern: /\bav\.\s*J\.-C\./gu, replace: () => 'avant Jésus-Christ' },
  { pattern: /\bapr\.\s*J\.-C\./gu, replace: () => 'après Jésus-Christ' },
  { pattern: /\bJ\.-C\./gu, replace: () => 'Jésus-Christ' },
  // Centuries, kings, chapters: XIXe, Ier, IIe, 1re is left to the voice.
  {
    pattern: /(?<![\p{L}\p{N}])([IVXLCDM]{1,7})(er|re|ère|e|ème|è)(?![\p{L}\p{N}])/gu,
    replace: (m) => {
      const roman = m[1]!;
      // « Le », « Ce », « De », « Me » are words, not 50e / 100e / 500e / 1000e.
      if (roman.length === 1 && !'IVX'.includes(roman)) return null;
      const value = romanToInt(roman);
      if (value === null || value > 100) return null;
      const suffix = m[2]!;
      if (value === 1) return suffix === 're' || suffix === 'ère' ? 'première' : 'premier';
      return frenchOrdinal(value);
    },
  },
  // « Louis XIV », « chapitre III »: roman numeral right after a word, said as a number.
  {
    pattern: /(?<=(?:\p{Lu}\p{Ll}+|chapitre|tome|livre|partie|acte|scène)[\s ])([IVXLC]{1,6})(?![\p{L}\p{N}]|\.\s*\p{Lu})/gu,
    replace: (m) => {
      const value = romanToInt(m[1]!);
      if (value === null || value < 2 || value > 60) return null;
      return frenchCardinal(value);
    },
  },
  { pattern: new RegExp(String.raw`\bMM\.` + UPPER_NEXT, 'gu'), replace: () => 'Messieurs' },
  { pattern: new RegExp(String.raw`\bM\.` + UPPER_NEXT, 'gu'), replace: () => 'Monsieur' },
  { pattern: /\bMmes\b\.?/gu, replace: () => 'Mesdames' },
  { pattern: /\bMme\b\.?/gu, replace: () => 'Madame' },
  { pattern: /\bMlles\b\.?/gu, replace: () => 'Mesdemoiselles' },
  { pattern: /\bMlle\b\.?/gu, replace: () => 'Mademoiselle' },
  { pattern: new RegExp(String.raw`\bDr\.?` + UPPER_NEXT, 'gu'), replace: () => 'Docteur' },
  { pattern: new RegExp(String.raw`\bSte` + UPPER_NEXT, 'gu'), replace: () => 'Sainte' },
  { pattern: new RegExp(String.raw`\bSt` + UPPER_NEXT, 'gu'), replace: () => 'Saint' },
  { pattern: /\b[nN]°\s?(?=\p{N})/gu, replace: () => 'numéro ' },
  { pattern: /\bpp\.\s?(?=\p{N})/gu, replace: () => 'pages ' },
  { pattern: /\bp\.\s?(?=\p{N})/gu, replace: () => 'page ' },
  { pattern: /\betc\./gu, replace: () => 'et cetera' },
  { pattern: /\bcf\./gu, replace: () => 'voir' },
  { pattern: /\bex\.\s?:?/gu, replace: () => 'exemple :' },
  // Dialogue dashes and OCR noise: silent, but keep a breath where a dash separated two parts.
  { pattern: /(^|\s)[—–](?=\s)/gu, replace: (m) => `${m[1] ?? ''},` },
  { pattern: /[«»“”„"]/gu, replace: () => ' ' },
  { pattern: /[|¦•■□▪►◄~_*#^\\]/gu, replace: () => ' ' },
  { pattern: /[­​-‍﻿]/gu, replace: () => '' },
];

interface Replacement {
  start: number;
  end: number;
  text: string;
}

/** Builds the spoken text. Replacements never overlap: earlier rules win. */
export function prepareSpokenText(source: string): SpokenText {
  const replacements: Replacement[] = [];
  const taken = (start: number, end: number): boolean => replacements.some((r) => start < r.end && end > r.start);
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(source)) !== null) {
      if (match[0].length === 0) {
        rule.pattern.lastIndex++;
        continue;
      }
      const start = match.index;
      const end = start + match[0].length;
      if (taken(start, end)) continue;
      const text = rule.replace(match);
      if (text === null) continue;
      replacements.push({ start, end, text });
    }
  }
  replacements.sort((a, b) => a.start - b.start);

  let out = '';
  const map: number[] = [];
  let cursor = 0;
  const push = (text: string, sourceIndex: (i: number) => number): void => {
    for (let i = 0; i < text.length; i++) {
      out += text[i];
      map.push(sourceIndex(i));
    }
  };
  for (const r of replacements) {
    const keep = source.slice(cursor, r.start);
    const base = cursor;
    push(keep, (i) => base + i);
    push(r.text, () => r.start);
    cursor = r.end;
  }
  const tailBase = cursor;
  push(source.slice(cursor), (i) => tailBase + i);

  // Collapse whitespace (keeps the first source position of each run).
  let text = '';
  const finalMap: number[] = [];
  for (let i = 0; i < out.length; i++) {
    const ch = out[i]!;
    const isSpace = /\s/u.test(ch);
    if (isSpace && (text.length === 0 || text.endsWith(' '))) continue;
    text += isSpace ? ' ' : ch;
    finalMap.push(map[i]!);
  }
  while (text.endsWith(' ')) {
    text = text.slice(0, -1);
    finalMap.pop();
  }
  // « , » created by a dash at the start: drop a leading comma.
  if (text.startsWith(',')) {
    text = text.slice(1).trimStart();
    finalMap.splice(0, finalMap.length - text.length);
  }

  return {
    text,
    toSource(spokenIndex: number): number {
      if (finalMap.length === 0) return 0;
      const i = Math.min(Math.max(0, spokenIndex), finalMap.length - 1);
      return finalMap[i]!;
    },
  };
}

/**
 * §22 « Préparer la lecture »: the voice reads `prepared` (the words of `display`, punctuated for reading aloud) and the
 * positions map back onto `display`, so that the highlighted word stays right. null when the words differ.
 */
export function preparedSpokenText(display: string, prepared: string): SpokenText | null {
  const alignment = alignSpokenText(display, prepared);
  if (!alignment) return null;
  const { shown, said } = alignment;
  // Position in `display` of each character of `prepared`: inside a word, the same letter; punctuation, the end of the
  // word before it.
  const map: number[] = [];
  let w = 0;
  for (let i = 0; i < prepared.length; i++) {
    while (w < said.length && i >= said[w]!.end) w++;
    const word = said[w];
    if (word && i >= word.start) {
      const target = shown[w]!;
      map.push(target.start + Math.min(i - word.start, target.end - target.start - 1));
    } else {
      map.push(w === 0 ? shown[0]!.start : shown[w - 1]!.end);
    }
  }
  const inner = prepareSpokenText(prepared);
  return {
    text: inner.text,
    toSource(spokenIndex: number): number {
      if (map.length === 0) return 0;
      return map[Math.min(Math.max(0, inner.toSource(spokenIndex)), map.length - 1)]!;
    },
  };
}
