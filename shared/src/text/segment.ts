// STUB: shared-core
export interface SentenceSpan { start: number; end: number }   // [start,end) covers the sentence without outer spaces

// French rules (see contract §6). Stub: the whole trimmed text is one sentence.
export function segmentSentences(text: string): SentenceSpan[] {
  const start = text.search(/\S/);
  if (start < 0) return [];
  const end = text.trimEnd().length;
  return [{ start, end }];
}
