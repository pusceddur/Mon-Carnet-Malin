export interface SentenceSpan { start: number; end: number }   // [start,end) covers the sentence without outer spaces

const TERMINAL_RE = /[.!?…]+/g;
const BLANK_LINE_RE = /\n[^\S\n]*\n/g;
const DIALOGUE_LINE_RE = /\n[^\S\n]*(?:[\u2014\u2013]|-(?=\s))/g;
const ADJACENT_CLOSERS = new Set(['\u201D', '"', '\u2019', ')', ']']);

// Never end a sentence after these (case-sensitive titles).
const TITLE_ABBREVIATIONS = new Set(['M', 'MM', 'Mme', 'Mmes', 'Mlle', 'Mlles', 'Mgr', 'Me', 'Dr', 'Pr', 'St', 'Ste', 'Sts', 'Stes']);
// Never end a sentence after these (compared lowercased).
const ABBREVIATIONS = new Set(['p', 'pp', 'ex', 'cf', 'av', 'apr', 'vol', 'chap', 'fig', 'n°', 'env', 'éd', 'réf', 'coll', 'tél']);
// May end a sentence, but only before a capital, an opening quote or a dialogue dash.
const SOFT_ABBREVIATIONS = new Set(['etc', 'j.-c', 'j-c']);

function isSpace(c: string | undefined): boolean {
  return c !== undefined && /\s/.test(c);
}

function absorbClosers(text: string, from: number): number {
  let j = from;
  for (;;) {
    let q = j;
    while (q < text.length && /[^\S\n]/.test(text.charAt(q))) q++;
    if (text.charAt(q) === '»') { j = q + 1; continue; }
    if (ADJACENT_CLOSERS.has(text.charAt(j))) { j++; continue; }
    return j;
  }
}

function wordBefore(text: string, end: number): { word: string; start: number } {
  let i = end;
  while (i > 0 && /[\p{L}\p{N}\p{M}°.\-\u2010\u2011]/u.test(text.charAt(i - 1))) i--;
  let start = i;
  while (start < end && /[.\-\u2010\u2011]/.test(text.charAt(start))) start++;
  return { word: text.slice(start, end), start };
}

function isStrongStarter(c: string): boolean {
  return /[\p{Lu}«\u201C\u2014\u2013¿¡]/u.test(c);
}

function isStarter(text: string, k: number): boolean {
  const c = text.charAt(k);
  if (isStrongStarter(c) || /[\p{N}"\u2018(\[]/u.test(c)) return true;
  return c === '-' && isSpace(text.charAt(k + 1));
}

/** Sentence cut allowed after a single dot preceded by `word`? */
function dotEndsSentence(text: string, word: string, wordStart: number, sentenceStart: number, nextIndex: number): boolean {
  if (word.length === 0) return true;
  if (TITLE_ABBREVIATIONS.has(word) || ABBREVIATIONS.has(word.toLowerCase())) return false;
  if (SOFT_ABBREVIATIONS.has(word.toLowerCase())) return isStrongStarter(text.charAt(nextIndex));
  // Initials (« J. K. Rowling ») and dotted acronyms.
  if (/^\p{Lu}$/u.test(word) || /^(?:\p{Lu}\.)+\p{Lu}$/u.test(word)) return false;
  // List numbering at the start of a sentence (« 1. Le Soleil », « II. La Gaule »).
  if (/^(?:\d{1,3}|[IVXLCDM]{1,6})$/.test(word) && text.slice(sentenceStart, wordStart).trim() === '') return false;
  return true;
}

function collectCuts(text: string): number[] {
  const hardCuts: number[] = [];
  for (const m of text.matchAll(BLANK_LINE_RE)) hardCuts.push(m.index ?? 0);
  for (const m of text.matchAll(DIALOGUE_LINE_RE)) hardCuts.push(m.index ?? 0);
  hardCuts.sort((a, b) => a - b);

  const cuts = [...hardCuts];
  let lastCut = 0;
  let hardPtr = 0;
  for (const m of text.matchAll(TERMINAL_RE)) {
    const clusterStart = m.index ?? 0;
    while (hardPtr < hardCuts.length && hardCuts[hardPtr]! <= clusterStart) {
      lastCut = Math.max(lastCut, hardCuts[hardPtr]!);
      hardPtr++;
    }
    const j = absorbClosers(text, clusterStart + m[0].length);
    if (j >= text.length || !isSpace(text.charAt(j))) continue;
    let k = j;
    while (k < text.length && isSpace(text.charAt(k))) k++;
    if (k >= text.length) continue;
    if (!isStarter(text, k)) continue;
    if (m[0] === '.') {
      const { word, start } = wordBefore(text, clusterStart);
      let sentenceStart = lastCut;
      while (sentenceStart < clusterStart && isSpace(text.charAt(sentenceStart))) sentenceStart++;
      if (!dotEndsSentence(text, word, start, sentenceStart, k)) continue;
    }
    cuts.push(j);
    lastCut = j;
  }
  return [...new Set(cuts)].sort((a, b) => a - b);
}

/**
 * French sentence segmentation. A sentence ends after . ! ? … (and closing quotes) followed by a space and
 * a capital, a digit, an opening quote or a dialogue dash; never after common abbreviations, initials or
 * list numbers. Blank lines and dialogue lines always start a new sentence.
 */
export function segmentSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  let segStart = 0;
  for (const cut of [...collectCuts(text), text.length]) {
    let start = segStart;
    let end = cut;
    while (start < end && isSpace(text.charAt(start))) start++;
    while (end > start && isSpace(text.charAt(end - 1))) end--;
    if (end > start) spans.push({ start, end });
    segStart = cut;
  }
  return spans;
}
