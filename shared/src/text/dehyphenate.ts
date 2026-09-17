const LINE_END_HYPHEN_RE = /([\p{L}\p{N}]+)[-\u2010\u2011\u00AC]$/u;
const SOFT_HYPHEN_END_RE = /\u00AD$/;

/**
 * Joins OCR/PDF lines into one text. A word cut at the end of a line (« pho- » + « tosynthèse ») is re-joined
 * without hyphen when both sides are lowercase; the hyphen is kept for real compounds (« arc-en- » + « ciel »,
 * « Jean- » + « Pierre ») and, when `isKnownWord` is given, when both halves are words but the joined form is not
 * (« grand- » + « mère »).
 */
export function joinOcrLines(lines: string[], isKnownWord?: (w: string) => boolean): string {
  let out = '';
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length === 0) continue;
    if (out.length === 0) {
      out = line;
      continue;
    }
    if (SOFT_HYPHEN_END_RE.test(out)) {
      out = out.slice(0, -1) + line;
      continue;
    }
    const hyphen = LINE_END_HYPHEN_RE.exec(out);
    if (hyphen) {
      const head = hyphen[1] ?? '';
      const lastWord = /[\p{L}\p{N}\-\u2010\u2011]+[-\u2010\u2011\u00AC]$/u.exec(out)?.[0] ?? '';
      const tail = /^[\p{L}\p{M}]+/u.exec(line)?.[0] ?? '';
      const bothLower = /\p{Ll}$/u.test(head) && /^\p{Ll}/u.test(line);
      const compound = /[-\u2010\u2011]/.test(lastWord.slice(0, -1));
      const knownHalves = isKnownWord !== undefined && tail.length > 0 && isKnownWord(head.toLowerCase())
        && isKnownWord(tail.toLowerCase()) && !isKnownWord((head + tail).toLowerCase());
      if (bothLower && !compound && !knownHalves) {
        out = out.slice(0, -1) + line;
      } else if (/[-\u2010\u2011]$/.test(out) && /^[\p{L}\p{N}]/u.test(line)) {
        out = out + line;
      } else {
        out = `${out.slice(0, -1)}-${line}`;
      }
      continue;
    }
    out = `${out} ${line}`;
  }
  return out;
}
