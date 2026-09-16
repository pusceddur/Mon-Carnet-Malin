// STUB: shared-core
// NFKC -> lowercase -> strip diacritics -> œ/æ -> unify quotes/dashes -> punctuation -> space -> collapse spaces -> trim
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// NFC, collapse spaces, remove control chars/soft hyphen, keep French typography
export function normalizeDisplayText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/­/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
