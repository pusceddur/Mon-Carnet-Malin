export interface WordToken { start: number; end: number; word: string }

// Letters/digits, joined by an inner hyphen or middle dot, or by a decimal separator between digits.
const WORD_RE = /[\p{L}\p{N}\p{M}]+(?:(?:[-\u2010\u2011\u00B7](?=[\p{L}\p{N}])|(?<=\p{N})[.,](?=\p{N}))[\p{L}\p{N}\p{M}]+)*/gu;
const APOSTROPHE_RE = /['\u2019\u02BC]/;

// Words whose apostrophe is part of the word itself (not an elision).
const APOSTROPHE_WORDS = new Set([
  "aujourd'hui", "presqu'île", "presqu'îles", "quelqu'un", "quelqu'une", "prud'homme", "prud'hommes",
  "main-d'œuvre", "hors-d'œuvre", "entr'acte", "entr'actes",
]);

/** True when a token is an elided clitic such as « l’ », « qu’ », « j’ ». */
export function isElisionToken(word: string): boolean {
  return APOSTROPHE_RE.test(word.slice(-1));
}

/**
 * Word tokens with UTF-16 offsets.
 * « arc-en-ciel » is one token; « l’arbre » gives « l’ » + « arbre »; « 3,5 » is one token.
 */
export function tokenizeWords(text: string): WordToken[] {
  const raw: WordToken[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    raw.push({ start, end: start + m[0].length, word: m[0] });
  }
  const tokens: WordToken[] = [];
  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i]!;
    const next = raw[i + 1];
    const apostrophe = text.charAt(tok.end);
    if (next && APOSTROPHE_RE.test(apostrophe) && next.start === tok.end + 1 && /^\p{L}/u.test(next.word)) {
      const joined = text.slice(tok.start, next.end);
      if (APOSTROPHE_WORDS.has(joined.toLowerCase().replace(/[\u2019\u02BC]/g, "'"))) {
        tokens.push({ start: tok.start, end: next.end, word: joined });
        i++;
        continue;
      }
      tokens.push({ start: tok.start, end: tok.end + 1, word: text.slice(tok.start, tok.end + 1) });
      continue;
    }
    tokens.push(tok);
  }
  return tokens;
}
