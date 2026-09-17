// Thin wrapper over GET /api/dictionary (§7). The UI must use lookupDefinition (ai/aiClient.ts).
import type { DictionaryResult } from '@aide/shared';
import { api } from './http';

export const DICTIONARY_TIMEOUT_MS = 15_000;

/** Throws ApiError (offline, timeout, HTTP errors). */
export const getDictionary = (word: string, signal?: AbortSignal): Promise<DictionaryResult> =>
  api<DictionaryResult>('GET', `/api/dictionary?word=${encodeURIComponent(word)}`, undefined, { signal, timeoutMs: DICTIONARY_TIMEOUT_MS });
