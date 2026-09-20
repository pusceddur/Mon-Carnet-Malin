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

// §18.2.7 local fallback of a free question: « c'est quoi X », « que veut dire X », « qu'est-ce qu'un(e) X »,
// « ça veut dire quoi X » → X is looked up in the glossary / dictionary (same path as explain_word).
const ARTICLE = "(?:(?:un|une|le|la|les|des|du)\\s+|l'|d')?";
const WORD_OR_PHRASE = "(?:le\\s+mot\\s+|l'expression\\s+)?";
const TERM = "([\\p{L}][\\p{L}'\\- ]*)";
const DEFINITION_QUESTIONS: readonly RegExp[] = [
  new RegExp(`^c'?\\s?est\\s+quoi\\s*,?\\s*${WORD_OR_PHRASE}${ARTICLE}${TERM}$`, 'u'),
  new RegExp(`^qu'est-ce\\s+que\\s+c'est\\s*,?\\s*(?:qu'|que\\s+)?${WORD_OR_PHRASE}${ARTICLE}${TERM}$`, 'u'),
  new RegExp(`^qu'est-ce\\s+qu'(?:un|une)\\s+${TERM}$`, 'u'),
  new RegExp(`^qu'est-ce\\s+que\\s+${WORD_OR_PHRASE}(?:(?:le|la|les)\\s+|l')${TERM}$`, 'u'),
  new RegExp(`^(?:que|qu'est-ce\\s+que|qu'est-ce\\s+qu'il|qu'est-ce\\s+qu'elle)\\s+(?:veut\\s+dire|veulent\\s+dire|signifie|signifient)\\s+${WORD_OR_PHRASE}${ARTICLE}${TERM}$`, 'u'),
  new RegExp(`^(?:ça|ca)\\s+veut\\s+dire\\s+quoi\\s*,?\\s+${WORD_OR_PHRASE}${ARTICLE}${TERM}$`, 'u'),
  new RegExp(`^${WORD_OR_PHRASE}${ARTICLE}${TERM}\\s*,?\\s+(?:ça|ca)\\s+veut\\s+dire\\s+quoi$`, 'u'),
];
const TERM_MAX_WORDS = 4;
const TERM_MAX_CHARS = 60;

/** The word or short expression asked about by a definition question, lowercase; null for any other question. */
export function definitionTermOf(question: string): string | null {
  const text = question
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[«»“”"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s?!.…:;]+$/u, '')
    .replace(/\s*-\s*/g, '-');
  for (const re of DEFINITION_QUESTIONS) {
    const term = re.exec(text)?.[1]?.replace(/-+$/, '').trim();
    if (!term) continue;
    if (term.length > TERM_MAX_CHARS || term.split(' ').length > TERM_MAX_WORDS) return null;
    return term;
  }
  return null;
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
