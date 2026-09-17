// French word list used by SourceGuard (proper noun detection). Loaded lazily, once per process.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createWordList, normalizeForMatch, type WordList } from '@aide/shared';
import type { Logger } from '../logger';

let cached: WordList | null = null;
let failed = false;

/**
 * `isKnownWord` backed by an-array-of-french-words. Resolved from the working directory so that it works both from
 * the TypeScript sources and from the CJS bundle. When the list cannot be loaded every word counts as known
 * (fewer proper noun candidates: favours false negatives over false refusals).
 */
export function loadKnownWords(logger: Logger): (word: string) => boolean {
  if (!cached && !failed) {
    try {
      const require = createRequire(join(process.cwd(), 'noop.js'));
      const words = require('an-array-of-french-words') as unknown;
      if (!Array.isArray(words)) throw new Error('unexpected word list format');
      cached = createWordList(words.filter((w): w is string => typeof w === 'string'));
    } catch (err) {
      failed = true;
      logger.error('ai_word_list_unavailable', { error: err });
    }
  }
  const list = cached;
  if (!list) return () => true;
  return (word) => list.has(normalizeForMatch(word));
}
