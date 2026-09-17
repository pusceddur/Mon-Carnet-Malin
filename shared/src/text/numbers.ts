const UNITS: Readonly<Record<string, number>> = {
  zéro: 0, zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
};
const TENS: Readonly<Record<string, number>> = {
  vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, septante: 70, octante: 80, huitante: 80, nonante: 90,
};
const HUNDREDS = new Set(['cent', 'cents']);
const SCALES: Readonly<Record<string, number>> = { mille: 1000, mil: 1000, million: 1e6, millions: 1e6, milliard: 1e9, milliards: 1e9 };

/** Every word that may appear inside a French number written in letters. */
export const NUMBER_WORDS: ReadonlySet<string> = new Set([...Object.keys(UNITS), ...Object.keys(TENS), ...HUNDREDS, ...Object.keys(SCALES)]);

const ORDINAL_SUFFIX = '(?:e|es|er|ers|re|res|ère|ères|ème|èmes|eme|emes|è|nd|nde|nds|ndes)';
const DIGITS_RE = new RegExp(
  `^([+\\-\u2212]?)(\\d{1,3}(?:[ .]\\d{3})+|\\d+)(?:[,.](\\d+))?(?:(${ORDINAL_SUFFIX}))?(?: (mille|millions?|milliards?))?$`,
);
const ROMAN_RE = new RegExp(`^(?=[IVXLCDM])(M{0,3})(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})(${ORDINAL_SUFFIX})?$`);
const ROMAN_VALUES: Readonly<Record<string, number>> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

type Parsed = [value: number, next: number];

function unitIn(word: string | undefined, min: number, max: number): number | null {
  if (word === undefined) return null;
  const v = UNITS[word];
  return v !== undefined && v >= min && v <= max ? v : null;
}

/** 1..19 after « soixante » / « quatre-vingt » (teens allowed) or 1..9 after other tens. */
function parseTail(w: string[], i: number, allowTeens: boolean): Parsed | null {
  if (allowTeens) {
    if (w[i] === 'dix') {
      const u = unitIn(w[i + 1], 7, 9);
      return u !== null ? [10 + u, i + 2] : [10, i + 1];
    }
    const teen = unitIn(w[i], 11, 16);
    if (teen !== null) return [teen, i + 1];
  }
  const u = unitIn(w[i], 1, 9);
  return u !== null ? [u, i + 1] : null;
}

function parseBelow100(w: string[], i: number): Parsed | null {
  const a = w[i];
  if (a === undefined) return null;
  if (a === 'quatre' && (w[i + 1] === 'vingt' || w[i + 1] === 'vingts')) {
    const tail = w[i + 1] === 'vingt' ? parseTail(w, i + 2, true) : null;
    return tail ? [80 + tail[0], tail[1]] : [80, i + 2];
  }
  const ten = TENS[a];
  if (ten !== undefined) {
    const tail = parseTail(w, i + 1, ten === 60);
    return tail ? [ten + tail[0], tail[1]] : [ten, i + 1];
  }
  if (a === 'dix') {
    const u = unitIn(w[i + 1], 7, 9);
    if (u !== null) return [10 + u, i + 2];
  }
  const unit = UNITS[a];
  return unit !== undefined ? [unit, i + 1] : null;
}

function parseBelow1000(w: string[], i: number): Parsed | null {
  let hundreds = 0;
  let j = i;
  if (HUNDREDS.has(w[j] ?? '')) {
    hundreds = 100;
    j++;
  } else {
    const u = unitIn(w[j], 2, 9);
    if (u !== null && HUNDREDS.has(w[j + 1] ?? '')) {
      hundreds = u * 100;
      j += 2;
    }
  }
  if (hundreds > 0 && w[j] !== undefined && (w[j] === 'zéro' || w[j] === 'zero')) return [hundreds, j];
  const rest = parseBelow100(w, j);
  if (rest) {
    if (hundreds > 0 && rest[0] === 0) return [hundreds, j];
    return [hundreds + rest[0], rest[1]];
  }
  return hundreds > 0 ? [hundreds, j] : null;
}

/** Value of a whole list of cardinal number words, or null when the list is not exactly one number. */
function parseCardinal(w: string[]): number | null {
  if (w.length === 0) return null;
  if (w.length === 1 && (w[0] === 'zéro' || w[0] === 'zero')) return 0;
  let total = 0;
  let lastScale = Number.POSITIVE_INFINITY;
  let i = 0;
  while (i < w.length) {
    const group = parseBelow1000(w, i);
    if (group && group[0] === 0) return null;
    const next = group ? group[1] : i;
    const scaleWord = w[next];
    const scale = scaleWord !== undefined ? SCALES[scaleWord] : undefined;
    if (scale !== undefined) {
      if (scale >= lastScale) return null;
      if (!group && scale !== 1000) return null;
      total += (group ? group[0] : 1) * scale;
      lastScale = scale;
      i = next + 1;
      continue;
    }
    if (!group || next !== w.length) return null;
    return total + group[0];
  }
  return total;
}

function splitNumberWords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s\-\u2010\u2011]+/)
    .filter((x) => x.length > 0 && x !== 'et');
}

const ORDINAL_STEMS: Readonly<Record<string, string>> = { cinqu: 'cinq', neuv: 'neuf', un: 'un' };

function ordinalWordToCardinal(word: string): string | null {
  const m = /^(.+?)i[èe]mes?$/.exec(word);
  if (!m) return null;
  const stem = m[1]!;
  const mapped = ORDINAL_STEMS[stem];
  if (mapped) return mapped;
  if (NUMBER_WORDS.has(stem)) return stem;
  if (NUMBER_WORDS.has(`${stem}e`)) return `${stem}e`;
  return null;
}

function parseWords(s: string): string | null {
  const words = splitNumberWords(s);
  if (words.length === 0) return null;
  if (words.length === 1 && /^premi(?:er|ère|ers|ères)$/.test(words[0]!)) return '1e';
  const last = words[words.length - 1]!;
  const ordinalBase = ordinalWordToCardinal(last);
  if (ordinalBase !== null) {
    if (ordinalBase === 'un' && words.length === 1) return null;
    const value = parseCardinal([...words.slice(0, -1), ordinalBase]);
    return value !== null && value > 0 ? `${value}e` : null;
  }
  if (!words.every((x) => NUMBER_WORDS.has(x))) return null;
  const value = parseCardinal(words);
  return value !== null ? String(value) : null;
}

function romanValue(roman: string): number {
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const v = ROMAN_VALUES[roman.charAt(i)] ?? 0;
    const next = ROMAN_VALUES[roman.charAt(i + 1)] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '');
}

/** int.frac × 10^zeros as a canonical decimal string. */
function scaleDecimal(intPart: string, fracPart: string, zeros: number): string {
  const frac = fracPart.replace(/0+$/, '');
  if (zeros === 0) return frac.length > 0 ? `${stripLeadingZeros(intPart)}.${frac}` : stripLeadingZeros(intPart);
  const shifted = frac.padEnd(zeros, '0');
  const intDigits = stripLeadingZeros(intPart + shifted.slice(0, zeros));
  const rest = shifted.slice(zeros).replace(/0+$/, '');
  return rest.length > 0 ? `${intDigits}.${rest}` : intDigits;
}

function parseDigits(s: string): string | null {
  const m = DIGITS_RE.exec(s);
  if (!m) return null;
  const [, sign = '', intRaw = '', fracRaw, ordinal, scaleWord] = m;
  const intPart = intRaw.replace(/[ .]/g, '');
  if (ordinal !== undefined && (fracRaw !== undefined || scaleWord !== undefined || sign !== '')) return null;
  const zeros = scaleWord === undefined ? 0 : scaleWord.startsWith('milliard') ? 9 : scaleWord.startsWith('million') ? 6 : 3;
  const value = scaleDecimal(intPart, fracRaw ?? '', zeros);
  if (ordinal !== undefined) return value === '0' ? null : `${value}e`;
  return sign !== '' && sign !== '+' && /[1-9]/.test(value) ? `-${value}` : value;
}

/**
 * Canonical form of a French number token, or null when the token is not a number:
 * « 1 000 », « 1.000 » → "1000"; « 3,5 » → "3.5"; « vingt-et-un » → "21"; « 2,5 millions » → "2500000";
 * ordinals « XIXe », « 19ème », « dix-neuvième » → "19e"; « 1er », « Ire », « première » → "1e".
 * Uppercase roman numerals are read as numbers (except a lone C, D, L or M): callers decide from the context.
 */
export function normalizeNumberFr(token: string): string | null {
  const s = token.normalize('NFKC').replace(/[\u00A0\u202F\u2007]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length === 0) return null;
  if (/^[+\-\u2212]?\d/.test(s)) return parseDigits(s);
  const words = parseWords(s);
  if (words !== null) return words;
  const roman = ROMAN_RE.exec(s);
  if (roman) {
    const numeral = s.slice(0, s.length - (roman[5]?.length ?? 0));
    // A lone C, D, L or M is far more often a letter, a title (« M. ») or an article (« Le », « De ») than a number.
    if (/^[CDLM]$/.test(numeral)) return null;
    const value = romanValue(numeral);
    return roman[5] !== undefined ? `${value}e` : String(value);
  }
  return null;
}
