import { KID_MESSAGES, type AIPageInput, type Id, type SummaryData, type SummaryLevel } from '@aide/shared';
import { summarizeProgressively } from '../../../ai/aiClient';
import { kidMessage } from './aiResults';

export type SummaryOutcome =
  | { kind: 'ok'; data: SummaryData; origin: 'ai' | 'local'; sourceWarning: boolean }
  | { kind: 'blocked'; message: string }
  | { kind: 'unavailable'; message: string | null }   // null: no usable text at all
  | { kind: 'aborted' };

export interface SummaryInput {
  childId: Id;
  documentId: Id;
  documentHash: string | null;
  level: SummaryLevel;
  pages: AIPageInput[];
  /** Parent settings allow the online summary. */
  aiAllowed: boolean;
  onProgress: (done: number, total: number) => void;
  signal?: AbortSignal;
}

function hasContent(data: SummaryData): boolean {
  return data.summary.trim().length > 0 || data.keyPoints.some((k) => k.trim().length > 0);
}

/** Progressive summary by the AI; nothing is summarized on the device any more (decision 2026-09-19). */
export async function buildSummary(input: SummaryInput): Promise<SummaryOutcome> {
  const lowConfidence = input.pages.some((p) => p.ocrLowConfidence);
  if (input.pages.length === 0) return { kind: 'unavailable', message: null };

  let unavailableMessage: string | null = null;
  if (input.aiAllowed) {
    const result = await summarizeProgressively(
      { childId: input.childId, documentId: input.documentId, documentHash: input.documentHash, level: input.level, pages: input.pages },
      input.onProgress,
      input.signal,
    );
    if (input.signal?.aborted) return { kind: 'aborted' };
    if (result.status === 'ok' && hasContent(result.data)) {
      return {
        kind: 'ok',
        data: result.data,
        origin: result.meta.route === 'local' ? 'local' : 'ai',
        sourceWarning: result.meta.sourceWarning || lowConfidence,
      };
    }
    if (result.status === 'blocked') return { kind: 'blocked', message: kidMessage(result) };
    if (result.status !== 'ok') unavailableMessage = kidMessage(result);
  }

  input.onProgress(1, 1);
  return { kind: 'unavailable', message: unavailableMessage ?? KID_MESSAGES.unavailable };
}
