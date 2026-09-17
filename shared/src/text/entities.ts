import { normalizeForMatch } from './normalize';
import { NUMBER_WORDS, normalizeNumberFr } from './numbers';
import { segmentSentences } from './segment';
import { isStopword } from './stopwords';
import { isElisionToken, tokenizeWords, type WordToken } from './tokenize';

export interface Entities { numbers: string[]; years: string[]; properNouns: string[] }

/** Common nouns often capitalized in school texts: never treated as proper nouns (§15.5). */
export const CAPITALIZED_COMMON: ReadonlySet<string> = new Set([
  'soleil', 'terre', 'lune', 'univers', 'galaxie', 'voie lactée', 'système solaire', 'ciel', 'espace', 'nature',
  'état', 'états', 'église', 'églises', 'moyen âge', 'haut moyen âge', 'antiquité', 'préhistoire', 'paléolithique', 'néolithique',
  'renaissance', 'révolution', 'révolution française', 'révolution industrielle', 'république', 'empire', 'royaume',
  'temps modernes', 'lumières', 'siècle des lumières', 'âge du bronze', 'âge du fer', 'grande guerre', 'guerre mondiale',
  'première guerre mondiale', 'seconde guerre mondiale', 'deuxième guerre mondiale', 'résistance', 'libération',
  'nation', 'gouvernement', 'parlement', 'assemblée nationale', 'sénat', 'constitution', 'président', 'ministre',
  'premier ministre', 'roi', 'reine', 'empereur', 'impératrice', 'prince', 'princesse', 'pape', 'seigneur', 'dieu', 'dieux',
  'océan', 'mer', 'nord', 'sud', 'est', 'ouest', 'pôle nord', 'pôle sud', 'équateur', 'hémisphère nord', 'hémisphère sud',
  'occident', 'orient', 'hexagone', 'région', 'département', 'commune', 'homme', 'humanité', 'histoire', 'géographie',
  'monsieur', 'madame', 'mademoiselle', 'maman', 'papa', 'mamie', 'papi', 'papy', 'maître', 'maîtresse',
  'noël', 'pâques', 'nouvel an',
]);

// Titles after which the next capitalized word is a name.
const HONORIFICS = new Set(['m', 'mm', 'mme', 'mmes', 'mlle', 'mlles', 'dr', 'pr', 'me', 'mgr', 'monsieur', 'madame', 'mademoiselle']);
const COMMON_NORMALIZED: ReadonlySet<string> = new Set([...CAPITALIZED_COMMON].map((w) => normalizeForMatch(w)));
const MAX_COMMON_WORDS = 4;
const ROMAN_TOKEN_RE = /^[IVXLCDM]+(?:e|es|er|re|ère|ème|èmes|eme|è)?$/;
// Words after which a bare roman numeral is a number (« chapitre IV »), and words announcing one (« XVe siècle »).
const ROMAN_AFTER = new Set(['chapitre', 'tome', 'partie', 'livre', 'acte', 'scène', 'volume', 'leçon', 'titre', 'article', 'épisode']);
const ROMAN_BEFORE_RE = /^(?:siècles?|millénaires?|république|dynastie|arrondissement)$/i;
const SPACES_ONLY_RE = /^[ \u00A0\u202F]+$/;

function isCommonCapitalized(normalized: string): boolean {
  return COMMON_NORMALIZED.has(normalized) || COMMON_NORMALIZED.has(normalized.replace(/[sx]$/, ''));
}

function isKnown(word: string, isKnownWord: (w: string) => boolean): boolean {
  const lower = word.toLowerCase();
  if (isKnownWord(lower)) return true;
  const parts = lower.split(/[-\u2010\u2011]/);
  return parts.length > 1 && parts.every((p) => p.length > 0 && isKnownWord(p));
}

function pushUnique(list: string[], seen: Set<string>, value: string, key = value): void {
  if (seen.has(key)) return;
  seen.add(key);
  list.push(value);
}

/**
 * Deterministic entities used by the source guard (§15.5).
 * numbers: canonical values from normalizeNumberFr (years excluded); years: 4-digit years (1000-2199);
 * properNouns: runs of capitalized words. A capitalized word inside a sentence is a proper noun unless it is a
 * known word whose lowercase form also appears in the text (or in `options.contextText`); at the start of a
 * sentence only unknown words are proper nouns. CAPITALIZED_COMMON words are never proper nouns.
 * `isKnownWord` receives the lowercase word (with accents).
 */
export function extractEntities(text: string, isKnownWord: (w: string) => boolean, options?: { contextText?: string }): Entities {
  const tokens = tokenizeWords(text);
  const numbers: string[] = [];
  const years: string[] = [];
  const properNouns: string[] = [];
  const seenNumbers = new Set<string>();
  const seenYears = new Set<string>();
  const seenNouns = new Set<string>();

  const lowercaseForms = new Set<string>();
  for (const source of [text, options?.contextText ?? '']) {
    for (const t of tokenizeWords(source)) {
      if (/^[^\p{Lu}]*$/u.test(t.word)) lowercaseForms.add(normalizeForMatch(t.word));
    }
  }

  const sentenceStarts = new Set<number>();
  let si = 0;
  const spans = segmentSentences(text);
  for (let i = 0; i < tokens.length; i++) {
    while (si < spans.length && spans[si]!.end <= tokens[i]!.start) si++;
    const span = spans[si];
    const prev = tokens[i - 1];
    if (!prev || (span && prev.end <= span.start)) sentenceStarts.add(i);
    else if (/[«\u201C\u2014\u2013:\n]/.test(text.slice(prev.end, tokens[i]!.start))) sentenceStarts.add(i);
  }

  const gap = (a: WordToken, b: WordToken): string => text.slice(a.end, b.start);
  const consumed = new Set<number>();

  // Numbers written with digits (thousands groups, decimals, scale words) or in letters.
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (/^\d/.test(tok.word)) {
      if (/^\d+[-\u2010\u2011]\d+$/.test(tok.word)) {
        for (const part of tok.word.split(/[-\u2010\u2011]/)) addNumber(part, true);
        consumed.add(i);
        continue;
      }
      let j = i;
      let joined = tok.word;
      if (/^\d{1,3}$/.test(tok.word)) {
        while (tokens[j + 1] && /^\d{3}(?:,\d+)?$/.test(tokens[j + 1]!.word) && SPACES_ONLY_RE.test(gap(tokens[j]!, tokens[j + 1]!))
          && gap(tokens[j]!, tokens[j + 1]!).length === 1) {
          j++;
          joined += ` ${tokens[j]!.word}`;
          if (joined.includes(',')) break;
        }
      }
      const scale = tokens[j + 1];
      if (scale && /^(?:mille|millions?|milliards?)$/i.test(scale.word) && SPACES_ONLY_RE.test(gap(tokens[j]!, scale))) {
        const scaled = normalizeNumberFr(`${joined} ${scale.word.toLowerCase()}`);
        if (scaled !== null) {
          j++;
          joined = `${joined} ${scale.word.toLowerCase()}`;
        }
      }
      for (let k = i; k <= j; k++) consumed.add(k);
      addNumber(joined, j === i);
      i = j;
      continue;
    }
    if (ROMAN_TOKEN_RE.test(tok.word) && !NUMBER_WORDS.has(tok.word.toLowerCase())) {
      const numeral = tok.word.replace(/[a-zè]+$/, '');
      const hasSuffix = numeral.length < tok.word.length;
      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      const afterName = prev !== undefined && SPACES_ONLY_RE.test(gap(prev, tok))
        && ((/^\p{Lu}\p{Ll}/u.test(prev.word) && !isStopword(normalizeForMatch(prev.word))) || ROMAN_AFTER.has(prev.word.toLowerCase()));
      const beforeContext = next !== undefined && ROMAN_BEFORE_RE.test(next.word);
      const accept = hasSuffix
        ? numeral.length >= 2 || /^I(?:er|re|ère)$/.test(tok.word) || beforeContext
        : afterName || beforeContext || (numeral.length >= 3 && !isKnown(tok.word, isKnownWord));
      const value = accept ? normalizeNumberFr(tok.word) : null;
      if (value !== null) {
        consumed.add(i);
        addNumber(value, false);
        continue;
      }
    }
    const lower = tok.word.toLowerCase();
    const parts = lower.split(/[-\u2010\u2011]/);
    if (parts.every((p) => NUMBER_WORDS.has(p) || p === 'et' || /i[èe]mes?$/.test(p) || /^premi(?:er|ère)s?$/.test(p))
      && normalizeNumberFr(lower) !== null) {
      // Longest run of number words (« deux mille vingt-quatre », « vingt et un »).
      let best = i;
      let bestValue = normalizeNumberFr(lower);
      let phrase = lower;
      for (let j = i + 1; j < tokens.length && SPACES_ONLY_RE.test(gap(tokens[j - 1]!, tokens[j]!)); j++) {
        phrase += ` ${tokens[j]!.word.toLowerCase()}`;
        const value = normalizeNumberFr(phrase);
        if (value !== null) {
          best = j;
          bestValue = value;
        } else if (tokens[j]!.word.toLowerCase() !== 'et') {
          break;
        }
      }
      if (bestValue !== null && !(best === i && (lower === 'un' || lower === 'une'))) {
        for (let k = i; k <= best; k++) consumed.add(k);
        addNumber(bestValue, false);
        i = best;
      }
    }
  }

  // Proper nouns.
  const commonTokens = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    if (!/^\p{Lu}/u.test(tokens[i]!.word)) continue;
    let phrase = normalizeForMatch(tokens[i]!.word);
    for (let n = 1; n <= MAX_COMMON_WORDS && i + n <= tokens.length; n++) {
      if (n > 1) {
        const t = tokens[i + n - 1]!;
        if (!SPACES_ONLY_RE.test(gap(tokens[i + n - 2]!, t))) break;
        phrase += ` ${normalizeForMatch(t.word)}`;
      }
      if (isCommonCapitalized(phrase)) for (let k = i; k < i + n; k++) commonTokens.add(k);
    }
  }

  let run: string[] = [];
  let runEnd: WordToken | null = null;
  const flush = (): void => {
    if (run.length > 0) {
      const name = run.join(' ');
      pushUnique(properNouns, seenNouns, name, normalizeForMatch(name));
    }
    run = [];
    runEnd = null;
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const proper = !consumed.has(i) && !commonTokens.has(i) && isProperNoun(i);
    if (!proper) {
      flush();
      continue;
    }
    if (runEnd !== null && !SPACES_ONLY_RE.test(gap(runEnd, tok))) flush();
    run.push(tok.word);
    runEnd = tok;
  }
  flush();

  return { numbers, years, properNouns };

  function addNumber(raw: string, mayBeYear: boolean): void {
    const value = normalizeNumberFr(raw);
    if (value === null) return;
    if (mayBeYear && /^\d{4}$/.test(raw) && Number(value) >= 1000 && Number(value) <= 2199) {
      pushUnique(years, seenYears, value);
      return;
    }
    pushUnique(numbers, seenNumbers, value);
  }

  function isProperNoun(i: number): boolean {
    const tok = tokens[i]!;
    const word = tok.word;
    if (!/^\p{Lu}/u.test(word) || isElisionToken(word) || word.length < 2) return false;
    const normalized = normalizeForMatch(word);
    if (HONORIFICS.has(normalized)) return false;
    const prev = tokens[i - 1];
    if (prev && HONORIFICS.has(normalizeForMatch(prev.word)) && /^[.\s\u00A0\u202F]+$/.test(gap(prev, tok))) return true;
    const letters = word.replace(/[^\p{L}]/gu, '');
    if (letters.length >= 2 && letters === letters.toUpperCase()) return !isKnown(word, isKnownWord);
    if (sentenceStarts.has(i)) return !isKnown(word, isKnownWord);
    return !(isKnown(word, isKnownWord) && lowercaseForms.has(normalized));
  }
}
