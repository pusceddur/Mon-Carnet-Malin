import { normalizeForMatch } from './normalize';
import { segmentSentences } from './segment';
import { isElisionToken, tokenizeWords } from './tokenize';

const VOWEL_RE = /[aeiouyàâäéèêëîïôöùûüÿœæ]/;
const TREMA_RE = /[ëïü]/;
const CLUSTER_RE = /[bcdfgkptv][rl]$/;

// Multi-group words ending in « -ent » where the ending is pronounced (the « -ment » words are handled by rule).
const PRONOUNCED_ENT = new Set([
  'absent', 'accent', 'accident', 'adjacent', 'adolescent', 'agent', 'apparent', 'argent', 'client', 'coefficient',
  'compétent', 'confident', 'content', 'continent', 'convalescent', 'décent', 'différent', 'diligent', 'éloquent',
  'équivalent', 'évident', 'excellent', 'expédient', 'fréquent', 'impatient', 'imprudent', 'incident', 'indécent',
  'indifférent', 'indulgent', 'ingrédient', 'innocent', 'insolent', 'intelligent', 'négligent', 'occident', 'omniprésent',
  'onguent', 'opulent', 'orient', 'parent', 'patient', 'permanent', 'pertinent', 'précédent', 'présent', 'président',
  'prudent', 'quotient', 'récent', 'récipient', 'régent', 'résident', 'sergent', 'serpent', 'somnolent', 'souvent',
  'strident', 'succulent', 'talent', 'torrent', 'transparent', 'trident', 'turbulent', 'urgent', 'violent', 'virulent',
]);

// Irregular pronunciations frequent in school texts.
const SPECIAL_SYLLABLES: Readonly<Record<string, number>> = {
  pays: 2, paysage: 3, paysages: 3, paysan: 3, paysans: 3, paysanne: 3, paysannes: 3, abbaye: 3, abbayes: 3,
};

const SILENT_ELISIONS = new Set(['l', 'd', 'j', 'm', 'n', 's', 't', 'c', 'qu']);

function isVowel(c: string | undefined): boolean {
  return c !== undefined && VOWEL_RE.test(c);
}

/** Does the vowel at index i start a new syllable although it follows another vowel? */
function isHiatus(word: string, i: number): boolean {
  const a = word.charAt(i - 1);
  const b = word.charAt(i);
  const rest = word.slice(i + 1);
  if (TREMA_RE.test(b)) return true;
  if (a === 'é') {
    // « idée », « idées », « créent » keep the final mute e in the same syllable.
    if (b === 'e' && (rest === '' || rest === 's' || rest === 'nt')) return false;
    return true;
  }
  if ((a === 'a' || a === 'o') && (b === 'é' || b === 'è')) return true;
  if (a === 'a' && (b === 'o' || b === 'ô')) return !(b === 'ô' || rest.startsWith('n'));
  if (a === 'o' && b === 'a') return true;
  const before = word.slice(0, i - 1);
  if (a === 'i' && CLUSTER_RE.test(before)) return true;
  if (a === 'u' && /[aeéè]/.test(b) && CLUSTER_RE.test(before)) return true;
  // « crayon », « voyage »: a y between vowels belongs to both syllables.
  if (a === 'y' && i >= 2 && isVowel(word.charAt(i - 2))) return true;
  return false;
}

function vowelGroups(word: string): number {
  let groups = 0;
  for (let i = 0; i < word.length; i++) {
    if (!isVowel(word.charAt(i))) continue;
    if (i === 0 || !isVowel(word.charAt(i - 1)) || isHiatus(word, i)) groups++;
  }
  return groups;
}

function stripMuteEnding(word: string): string {
  const candidates: string[] = [];
  if (word.endsWith('ent') && !word.endsWith('ment') && !PRONOUNCED_ENT.has(word)) candidates.push(word.slice(0, -3));
  if (/[qg]ues?$/.test(word)) candidates.push(word.replace(/ues?$/, ''));
  if (/[^aeiouyàâäéèêëîïôöùûüÿœæ]es?$/.test(word)) candidates.push(word.replace(/es?$/, ''));
  for (const c of candidates) {
    if (vowelGroups(c) >= 1) return c;
  }
  return word;
}

function countPart(part: string): number {
  if (part.length === 0) return 0;
  if (!/\p{L}/u.test(part)) return /\d/.test(part) ? Math.min(3, part.replace(/\D/g, '').length) : 0;
  const special = SPECIAL_SYLLABLES[part];
  if (special !== undefined) return special;
  return Math.max(1, vowelGroups(stripMuteEnding(part)));
}

/**
 * Spoken syllables of a French word (final mute e and verbal « -ent » not counted, no diaeresis),
 * e.g. « école » 2, « photosynthèse » 4, « ils mangent » 1. Hyphenated words add their parts.
 */
export function countSyllablesFr(word: string): number {
  const w = word.normalize('NFC').toLowerCase().replace(/[\u2019\u02BC]/g, "'").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (w.length === 0) return 0;
  let total = 0;
  const pieces = w.split(/([-\u2010\u2011'\s]+)/);
  for (let i = 0; i < pieces.length; i += 2) {
    const part = pieces[i] ?? '';
    const separator = pieces[i + 1] ?? '';
    if (separator.includes("'") && SILENT_ELISIONS.has(part)) continue;
    if (separator.includes("'") && /qu$/.test(part)) {
      total += Math.max(0, vowelGroups(part) - 1);
      continue;
    }
    total += countPart(part);
  }
  return Math.max(1, total);
}

export interface ReadabilityReport { words: number; sentences: number; avgWordsPerSentence: number; maxWordsPerSentence: number; longWordRatio: number /* >= 4 syllables */; kandelMoles: number }

const LONG_WORD_SYLLABLES = 4;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sentence and word statistics of a French text. Elided clitics (« l’ ») are not counted as words.
 * `exemptWords` (e.g. words of the source text) never count as long words and are left out of the syllable average.
 * kandelMoles = 207 − 1.015 × words/sentence − 73.6 × syllables/word (higher = easier).
 */
export function readabilityFr(text: string, exemptWords?: Iterable<string>): ReadabilityReport {
  const exempt = new Set<string>();
  if (exemptWords) {
    for (const w of exemptWords) for (const part of normalizeForMatch(w).split(' ')) if (part) exempt.add(part);
  }
  const tokens = tokenizeWords(text).filter((t) => !isElisionToken(t.word));
  const spans = segmentSentences(text);
  const perSentence: number[] = [];
  let ti = 0;
  for (const span of spans) {
    let n = 0;
    while (ti < tokens.length && tokens[ti]!.start < span.end) {
      if (tokens[ti]!.start >= span.start) n++;
      ti++;
    }
    if (n > 0) perSentence.push(n);
  }
  const words = tokens.length;
  const sentences = perSentence.length;
  let longWords = 0;
  let syllables = 0;
  let counted = 0;
  for (const t of tokens) {
    const norm = normalizeForMatch(t.word);
    if (exempt.has(norm) || norm.split(' ').every((p) => exempt.has(p))) continue;
    const s = countSyllablesFr(t.word);
    counted++;
    syllables += s;
    if (s >= LONG_WORD_SYLLABLES) longWords++;
  }
  const avgWordsPerSentence = sentences > 0 ? words / sentences : 0;
  const syllablesPerWord = counted > 0 ? syllables / counted : 0;
  return {
    words,
    sentences,
    avgWordsPerSentence: round2(avgWordsPerSentence),
    maxWordsPerSentence: perSentence.length > 0 ? Math.max(...perSentence) : 0,
    longWordRatio: words > 0 ? round2(longWords / words) : 0,
    kandelMoles: words > 0 ? round2(207 - 1.015 * avgWordsPerSentence - 73.6 * syllablesPerWord) : 0,
  };
}
