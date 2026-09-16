// STUB: client-reader — thin wrapper over §7 /api/dictionary
import type { DictionaryResult } from '@aide/shared';
import { api } from './http';

export const getDictionary = (word: string, signal?: AbortSignal): Promise<DictionaryResult> =>
  api<DictionaryResult>('GET', `/api/dictionary?word=${encodeURIComponent(word)}`, undefined, { signal, timeoutMs: 15_000 });
