import type { AIOperation } from '../types/ai';
import type { ChildProfile } from '../types/domain';
import { sha256Hex } from './sha256';

export interface AICacheKeyParts { documentHash: string | null; scope: string /* e.g. "p3" | "p0-24" | "chunk2" */; operation: AIOperation;
  inputHash: string; profileSignature: string; promptVersion: string; model: string }

/** sha256 of the JSON of the parts with keys in a fixed order (extra properties are ignored). */
export async function aiCacheKey(parts: AICacheKeyParts): Promise<string> {
  const ordered: AICacheKeyParts = {
    documentHash: parts.documentHash,
    scope: parts.scope,
    operation: parts.operation,
    inputHash: parts.inputHash,
    profileSignature: parts.profileSignature,
    promptVersion: parts.promptVersion,
    model: parts.model,
  };
  return sha256Hex(JSON.stringify(ordered));
}

/** "10|intermediaire|simple" */
export function profileSignature(p: Pick<ChildProfile, 'age' | 'readingLevel' | 'explanationDifficulty'>): string {
  return `${p.age}|${p.readingLevel}|${p.explanationDifficulty}`;
}
