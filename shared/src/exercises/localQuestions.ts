import { countWords } from '../ai/limits';
import { normalizeForMatch } from '../text/normalize';
import { NUMBER_WORDS } from '../text/numbers';
import { locateSentences, type LocatedSentence } from '../text/passages';
import { isStopword, lightStem } from '../text/stopwords';
import { tokenizeWords } from '../text/tokenize';
import type { AIPageInput } from '../types/ai';
import type { Question, QuestionType } from '../types/exercises';
import { EXERCISE_TEXTS_FR as T, formatText } from './messages.fr';

const MAX_QUESTIONS = 20;
const QUOTE_MAX_CHARS = 2000;
const ITEM_MAX_CHARS = 1000;
const LOCAL_TYPES: readonly QuestionType[] = ['qcm', 'ordre', 'vrai_faux'];
const PERSONAL_WORDS = new Set(['je', 'j', 'tu', 'te', 'toi', 'nous', 'vous', 'me', 'moi', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'notre', 'votre', 'nos', 'vos']);
const WORD_RE = /^\p{Ll}+(?:-\p{Ll}+)*$/u;

/** Deterministic PRNG (mulberry32). */
function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<V>(items: readonly V[], random: () => number): V[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

interface Sentence extends LocatedSentence { words: number; normalized: string }
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
interface Draft { order: number; question: DistributiveOmit<Question, 'id'> }
type WordClass = 'after_determiner' | 'after_pronoun' | 'other';
interface VocabularyWord { surface: string; normalized: string; stem: string; classes: Set<WordClass> }

const DETERMINERS = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux', 'ce', 'cet', 'cette', 'ces', 'mon',
  'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'notre', 'nos', 'votre', 'vos', 'leur', 'leurs', 'chaque', 'quelques', 'plusieurs']);
const SUBJECT_PRONOUNS = new Set(['je', 'j', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'qui', 'ne', 'n', 'se', 's']);

/** Rough grammatical context of a word from the word before it (a noun after « les », a verb after « il »). */
function wordClass(previous: string | undefined): WordClass {
  if (previous === undefined) return 'other';
  const p = normalizeForMatch(previous);
  if (DETERMINERS.has(p)) return 'after_determiner';
  return SUBJECT_PRONOUNS.has(p) ? 'after_pronoun' : 'other';
}

function lengthBucket(word: string): number {
  const n = word.replace(/-/g, '').length;
  return n <= 4 ? 0 : n <= 7 ? 1 : 2;
}

function isEligibleWord(word: string): boolean {
  if (!WORD_RE.test(word) || word.replace(/-/g, '').length < 4) return false;
  const n = normalizeForMatch(word);
  return !isStopword(n) && !NUMBER_WORDS.has(word);
}

function buildVocabulary(sentences: readonly Sentence[]): VocabularyWord[] {
  const byWord = new Map<string, VocabularyWord>();
  for (const s of sentences) {
    const tokens = tokenizeWords(s.text);
    tokens.forEach((t, i) => {
      if (!isEligibleWord(t.word)) return;
      const normalized = normalizeForMatch(t.word);
      let word = byWord.get(normalized);
      if (!word) {
        word = { surface: t.word, normalized, stem: lightStem(normalized.replace(/ /g, '')), classes: new Set() };
        byWord.set(normalized, word);
      }
      word.classes.add(wordClass(tokens[i - 1]?.word));
    });
  }
  return [...byWord.values()];
}

/**
 * Distractors from the same text and the same length class, preferring words seen in the same grammatical context
 * (after a determiner, after a subject pronoun) and with the same ending.
 */
function pickDistractors(answer: VocabularyWord, answerClass: WordClass, sentence: Sentence, vocabulary: readonly VocabularyWord[], random: () => number): string[] {
  const inSentence = new Set(tokenizeWords(sentence.text).map((t) => normalizeForMatch(t.word)));
  const bucket = lengthBucket(answer.surface);
  const plural = /[sx]$/.test(answer.normalized);
  const pool = vocabulary.filter((v) => v.normalized !== answer.normalized && v.stem !== answer.stem && !inSentence.has(v.normalized)
    && lengthBucket(v.surface) === bucket && /[sx]$/.test(v.normalized) === plural);
  const sameClass = (v: VocabularyWord): boolean => answerClass !== 'other' && v.classes.has(answerClass);
  const ending = (v: VocabularyWord, n: number): boolean => v.normalized.slice(-n) === answer.normalized.slice(-n);
  // « l’intérieur » / « la pression »: the blank must keep the elision correct.
  const startsWithVowel = (v: VocabularyWord): boolean => /^[aeiouyh]/.test(v.normalized);
  const fitsElision = (v: VocabularyWord): boolean => startsWithVowel(v) === startsWithVowel(answer) || v.normalized.startsWith('h');
  const rank = (v: VocabularyWord): number => (fitsElision(v) ? 0 : 10) + (sameClass(v) ? 0 : 3) + (ending(v, 2) ? 0 : ending(v, 1) ? 1 : 2);
  const ranked = shuffled(pool, random).sort((a, b) => rank(a) - rank(b));
  const chosen: VocabularyWord[] = [];
  for (const v of ranked) {
    if (chosen.length >= 3) break;
    if (chosen.some((c) => c.stem === v.stem)) continue;
    chosen.push(v);
  }
  return chosen.map((c) => c.surface);
}

function qcmDraft(sentence: Sentence, vocabulary: readonly VocabularyWord[], random: () => number): Draft | null {
  if (sentence.words < 6 || sentence.words > 25 || !/[.!…]$/.test(sentence.text)) return null;
  const tokens = tokenizeWords(sentence.text);
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(normalizeForMatch(t.word), (counts.get(normalizeForMatch(t.word)) ?? 0) + 1);
  const eligible = tokens
    .filter((t) => isEligibleWord(t.word) && counts.get(normalizeForMatch(t.word)) === 1)
    .sort((a, b) => b.word.length - a.word.length || a.start - b.start);
  const tries = shuffled(eligible.slice(0, 4), random);
  for (const token of tries) {
    const normalized = normalizeForMatch(token.word);
    const answerClass = wordClass(tokens[tokens.indexOf(token) - 1]?.word);
    const answer: VocabularyWord = { surface: token.word, normalized, stem: lightStem(normalized.replace(/ /g, '')), classes: new Set([answerClass]) };
    const distractors = pickDistractors(answer, answerClass, sentence, vocabulary, random);
    if (distractors.length < 2) continue;
    const choices = shuffled([token.word, ...distractors], random);
    const blanked = sentence.text.slice(0, token.start) + T.blank + sentence.text.slice(token.end);
    return {
      order: sentence.order,
      question: {
        type: 'qcm',
        prompt: formatText(T.qcmPrompt, { sentence: blanked.replace(/\s+/g, ' ') }),
        choices,
        correctIndex: choices.indexOf(token.word),
        explanation: formatText(T.qcmExplanation, { sentence: sentence.text.replace(/\s+/g, ' ') }),
        source: { pageIndex: sentence.pageIndex, quote: sentence.text },
      },
    };
  }
  return null;
}

function vraiFauxDraft(sentence: Sentence): Draft | null {
  if (sentence.words < 5 || sentence.words > 20 || !sentence.text.endsWith('.')) return null;
  if (/[«»\u201C\u201D"\u2014\u2013?!]/.test(sentence.text) || /^\s*-/.test(sentence.text)) return null;
  if (tokenizeWords(sentence.text).some((t) => PERSONAL_WORDS.has(normalizeForMatch(t.word)))) return null;
  return {
    order: sentence.order,
    question: {
      type: 'vrai_faux',
      prompt: formatText(T.vraiFauxPrompt, { sentence: sentence.text.replace(/\s+/g, ' ') }),
      answer: true,
      explanation: T.vraiFauxExplanation,
      source: { pageIndex: sentence.pageIndex, quote: sentence.text },
    },
  };
}

/** A real sentence ends with . ! ? or … (possibly followed by a closing quote); headings and captions do not. */
function endsLikeSentence(text: string): boolean {
  return /[.!?\u2026][\s\u00A0\u202F]*[»\u201D"’)]?$/.test(text);
}

function ordreDraft(window: readonly Sentence[], pages: readonly AIPageInput[]): Draft | null {
  const first = window[0];
  const last = window[window.length - 1];
  if (!first || !last) return null;
  const page = pages.find((p) => p.pageIndex === first.pageIndex);
  if (!page) return null;
  const quote = page.text.slice(first.start, last.end);
  if (quote.length > QUOTE_MAX_CHARS) return null;
  return {
    order: first.order,
    question: {
      type: 'ordre',
      prompt: T.ordrePrompt,
      itemsInOrder: window.map((s) => s.text),
      source: { pageIndex: first.pageIndex, quote },
    },
  };
}

/**
 * Local comprehension questions built only from the text (C12), deterministic for a given seed:
 * qcm « quel mot manque » (distractors taken from the same text), ordre (3 to 5 consecutive sentences),
 * vrai_faux with true sentences of the text only. Other types are ignored. source.quote is the exact sentence(s).
 */
export function generateLocalQuestions(pages: AIPageInput[], count: number, types: QuestionType[], seed: number = 1): Question[] {
  const wanted = Math.max(0, Math.min(MAX_QUESTIONS, Math.floor(count)));
  const kinds = LOCAL_TYPES.filter((t) => types.includes(t)).sort((a, b) => types.indexOf(a) - types.indexOf(b));
  if (wanted === 0 || kinds.length === 0) return [];
  const random = createRandom(seed);

  const seenSentences = new Set<string>();
  const sentences: Sentence[] = [];
  for (const s of locateSentences(pages)) {
    const normalized = normalizeForMatch(s.text);
    if (normalized.length === 0 || seenSentences.has(normalized)) continue;
    seenSentences.add(normalized);
    sentences.push({ ...s, words: countWords(s.text), normalized });
  }
  const vocabulary = buildVocabulary(sentences);
  const used = new Set<number>();
  const pools: Record<string, Sentence[]> = {
    qcm: shuffled(sentences, random),
    vrai_faux: shuffled(sentences, random),
    ordre: shuffled(sentences, random),
  };
  const byOrder = new Map(sentences.map((s) => [s.order, s]));

  const next = (kind: QuestionType): Draft | null => {
    const pool = pools[kind] ?? [];
    while (pool.length > 0) {
      const sentence = pool.shift()!;
      if (used.has(sentence.order)) continue;
      if (kind === 'qcm') {
        const draft = qcmDraft(sentence, vocabulary, random);
        if (draft) {
          used.add(sentence.order);
          return draft;
        }
      } else if (kind === 'vrai_faux') {
        const draft = vraiFauxDraft(sentence);
        if (draft) {
          used.add(sentence.order);
          return draft;
        }
      } else {
        const size = 3 + Math.floor(random() * 3);
        const window: Sentence[] = [];
        let o = sentence.order;
        while (window.length < size) {
          const s = byOrder.get(o);
          if (!s || used.has(o) || s.pageIndex !== sentence.pageIndex || s.words < 4 || s.words > 25 || s.text.length > ITEM_MAX_CHARS || !endsLikeSentence(s.text)) break;
          window.push(s);
          o++;
        }
        if (window.length < 3) continue;
        const draft = ordreDraft(window, pages);
        if (draft) {
          for (const s of window) used.add(s.order);
          return draft;
        }
      }
    }
    return null;
  };

  const drafts: Draft[] = [];
  const exhausted = new Set<QuestionType>();
  for (let i = 0; drafts.length < wanted && exhausted.size < kinds.length; i++) {
    const kind = kinds[i % kinds.length]!;
    if (exhausted.has(kind)) continue;
    const draft = next(kind);
    if (draft) drafts.push(draft);
    else exhausted.add(kind);
  }

  return drafts
    .sort((a, b) => a.order - b.order)
    .map((d, i) => ({ ...d.question, id: `local-${i + 1}` }) as Question);
}
