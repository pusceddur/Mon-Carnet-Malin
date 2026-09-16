// STUB: shared-core
import { LIMITS } from '../constants';
import { sha256Hex } from '../hash/sha256';
import type { AIPageInput } from '../types/ai';

export interface TextChunk { chunkIndex: number; pageIndexes: number[]; text: string; contentHash: string }

// Whole pages, in order; a page longer than maxChars is split at paragraph boundaries; deterministic.
// Stub: one chunk per page, no splitting.
export async function planChunks(pages: AIPageInput[], maxChars: number = LIMITS.chunkMaxChars): Promise<TextChunk[]> {
  void maxChars;
  const chunks: TextChunk[] = [];
  for (const [chunkIndex, page] of pages.entries()) {
    chunks.push({ chunkIndex, pageIndexes: [page.pageIndex], text: page.text, contentHash: await sha256Hex(page.text) });
  }
  return chunks;
}
