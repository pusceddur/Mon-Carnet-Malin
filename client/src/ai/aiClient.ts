// STUB: client-reader
import {
  KID_MESSAGES, type AIOperation, type AIResult, type DataFor, type DictionaryResult, type RequestFor, type SummarizeRequest,
  type SummaryData,
} from '@aide/shared';

function unavailable<T>(): AIResult<T> {
  return { status: 'unavailable', reason: 'not_configured', message: KID_MESSAGES.unavailable, meta: null };
}

/**
 * offline -> unavailable/offline immediately; local cache (Dexie aiCache); timeout 45 s (light) / 180 s (summarize,
 * generate_questions); errors -> unavailable. Never throws to the UI.
 */
export async function requestAI<Op extends AIOperation>(op: Op, body: RequestFor<Op>, opts?: { signal?: AbortSignal }): Promise<AIResult<DataFor<Op>>> {
  void op;
  void body;
  void opts;
  return unavailable<DataFor<Op>>();
}

/** Client-orchestrated progressive summary (C7): planChunks -> one request per chunk -> final request. */
export async function summarizeProgressively(req: Omit<SummarizeRequest, 'stage'>, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<AIResult<SummaryData>> {
  void req;
  void onProgress;
  void signal;
  return unavailable<SummaryData>();
}

/** Local glossary -> dictionaryCache -> /api/dictionary. */
export async function lookupDefinition(word: string): Promise<DictionaryResult> {
  void word;
  return { status: 'unavailable' };
}
