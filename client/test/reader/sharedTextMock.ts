// Contract-conformant stand-ins for shared text functions (§6), so reader tests do not depend on shared-core progress.
import type { SentenceSpan, WordToken } from '@aide/shared';

export function tokenizeWordsForTest(text: string): WordToken[] {
  const out: WordToken[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu)) {
    const start = m.index ?? 0;
    out.push({ start, end: start + m[0].length, word: m[0] });
  }
  return out;
}

export function segmentSentencesForTest(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  for (const m of text.matchAll(/[^.!?…]+(?:[.!?…]+|$)/gu)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    const start = (m.index ?? 0) + lead;
    out.push({ start, end: start + trimmed.length });
  }
  return out;
}
