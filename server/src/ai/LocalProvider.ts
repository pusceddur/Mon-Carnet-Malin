// Deterministic provider (C12, §15.4): faithful by construction, used when external AI is off, over quota or not configured.
import {
  extractiveSummary, generateLocalQuestions, LIMITS, segmentSentences, sha256HexSync, type AIOperation, type AIPageInput, type ChunkSummaryData,
  type GenerateQuestionsRequest, type QuestionsData, type SourceRef, type SummaryData, type SummaryLevel, type TextChunk,
} from '@aide/shared';

const LOCAL_QUOTE_MAX_CHARS = 300;

function firstSentence(text: string): string {
  const span = segmentSentences(text)[0];
  const sentence = span ? text.slice(span.start, span.end) : text.trim();
  return sentence.length > LOCAL_QUOTE_MAX_CHARS ? sentence.slice(0, LOCAL_QUOTE_MAX_CHARS).trimEnd() : sentence;
}

export class LocalProvider {
  readonly id = 'local' as const;

  supports(operation: AIOperation): boolean {
    return operation === 'summarize' || operation === 'generate_questions';
  }

  summarizeChunk(chunk: TextChunk, level: SummaryLevel): ChunkSummaryData {
    const page: AIPageInput = { pageIndex: chunk.pageIndexes[0] ?? 0, text: chunk.text, contentHash: chunk.contentHash, ocrLowConfidence: false };
    const extractive = extractiveSummary([page], level);
    let keyQuotes: SourceRef[] = extractive.sourceRefs.filter((r) => r.quote.trim() !== '').slice(0, LIMITS.chunkKeyQuotesMax);
    if (keyQuotes.length === 0) {
      const quote = firstSentence(chunk.text);
      keyQuotes = quote === '' ? [] : [{ pageIndex: page.pageIndex, quote }];
    }
    const summary = extractive.summary.trim() !== '' ? extractive.summary : keyQuotes.map((q) => q.quote).join(' ');
    return { chunkIndex: chunk.chunkIndex, summary, keyQuotes };
  }

  /** §15.4: without complex AI, the final summary is the deterministic union of the chunk summaries. */
  summarizeFinal(chunks: readonly ChunkSummaryData[]): SummaryData {
    const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const summary = ordered.map((c) => c.summary.trim()).filter((s) => s !== '').join('\n\n');
    const keyPoints = ordered
      .map((c) => firstSentence(c.summary))
      .filter((s) => s !== '')
      .slice(0, LIMITS.keyPointsMax);
    const sourceRefs = ordered.flatMap((c) => c.keyQuotes);
    return { summary, keyPoints, sourceRefs };
  }

  generateQuestions(req: Pick<GenerateQuestionsRequest, 'pages' | 'count' | 'types'>): QuestionsData | null {
    const seed = Number.parseInt(sha256HexSync(req.pages.map((p) => p.contentHash).join('|')).slice(0, 8), 16);
    const questions = generateLocalQuestions(req.pages, req.count, req.types, seed);
    return questions.length > 0 ? { questions: questions.slice(0, req.count) } : null;
  }
}
