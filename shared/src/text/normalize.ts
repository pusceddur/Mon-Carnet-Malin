const APOSTROPHES = /[\u2018\u2019\u201A\u201B\u02BC\u02B9`\u00B4\u2032]/g;
const QUOTES = /[«»\u201C\u201D\u201E\u201F\u2039\u203A\u2033]/g;
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

/**
 * Canonical form used to compare texts (quotes, cache keys, hashes).
 * NFKC -> lowercase -> strip diacritics -> œ/æ -> unify quotes/dashes -> punctuation to space -> collapse spaces -> trim.
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .replace(DASHES, '-')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const HORIZONTAL_SPACE_RUN = /[ \t\u00A0\u202F\u2007\u2009\u200A\u3000]{2,}/g;

function collapseSpaceRun(run: string): string {
  // Keep French typography: a run containing a (narrow) no-break space collapses to that space.
  if (run.includes('\u202F')) return '\u202F';
  if (run.includes('\u00A0')) return '\u00A0';
  return ' ';
}

/**
 * Text shown to the child: NFC, control characters / soft hyphens / zero-width spaces removed,
 * runs of spaces collapsed to one, French no-break spaces and quotes preserved.
 * Line breaks are kept (at most one blank line in a row).
 */
export function normalizeDisplayText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00AD\u200B\uFEFF\u2060]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\t/g, ' ')
    .replace(HORIZONTAL_SPACE_RUN, collapseSpaceRun)
    .replace(/[ \u00A0\u202F]*\n[ \u00A0\u202F]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
