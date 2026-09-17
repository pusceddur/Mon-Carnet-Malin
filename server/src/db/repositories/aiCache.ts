// ai_cache: validated AI outputs only (plus "blocked" markers for summary chunks, never shown to the child).
import { newId, type AIOperation } from '@aide/shared';
import { type Db, type Row, parseJson, toNumOrNull, toStr } from './common';

export type AICacheStatus = 'ok' | 'not_in_text' | 'readability_warning' | 'blocked';

export interface AICacheEntry {
  cacheKey: string;
  operation: AIOperation;
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  documentHash: string | null;
  contentHash: string | null;
  output: unknown;
  validationStatus: AICacheStatus;
  createdAt: number;
  expiresAt: number | null;
}

export interface AICacheRepository {
  get(cacheKey: string, now: number): Promise<AICacheEntry | null>;
  put(entry: AICacheEntry): Promise<void>;
}

const STATUSES: ReadonlySet<string> = new Set<AICacheStatus>(['ok', 'not_in_text', 'readability_warning', 'blocked']);

function fromRow(row: Row): AICacheEntry {
  const status = toStr(row.validation_status);
  return {
    cacheKey: toStr(row.cache_key),
    operation: toStr(row.operation) as AIOperation,
    provider: toStr(row.provider),
    model: toStr(row.model),
    promptVersion: toStr(row.prompt_version),
    inputHash: toStr(row.input_hash),
    documentHash: row.document_hash === null || row.document_hash === undefined ? null : toStr(row.document_hash),
    contentHash: row.content_hash === null || row.content_hash === undefined ? null : toStr(row.content_hash),
    output: parseJson<unknown>(row.output_json, null),
    validationStatus: STATUSES.has(status) ? (status as AICacheStatus) : 'blocked',
    createdAt: Number(row.created_at),
    expiresAt: toNumOrNull(row.expires_at),
  };
}

export function createAICacheRepository(db: Db): AICacheRepository {
  return {
    async get(cacheKey, now) {
      const row = (await db('ai_cache').where('cache_key', cacheKey).first()) as Row | undefined;
      if (!row) return null;
      const entry = fromRow(row);
      return entry.expiresAt !== null && entry.expiresAt <= now ? null : entry;
    },
    async put(entry) {
      await db('ai_cache')
        .insert({
          id: newId(),
          cache_key: entry.cacheKey,
          document_hash: entry.documentHash,
          content_hash: entry.contentHash,
          operation: entry.operation,
          provider: entry.provider.slice(0, 16),
          model: entry.model.slice(0, 100),
          prompt_version: entry.promptVersion,
          input_hash: entry.inputHash,
          output_json: JSON.stringify(entry.output),
          validation_status: entry.validationStatus,
          created_at: entry.createdAt,
          expires_at: entry.expiresAt,
        })
        .onConflict('cache_key')
        .merge(['provider', 'model', 'output_json', 'validation_status', 'created_at', 'expires_at', 'document_hash', 'content_hash']);
    },
  };
}

/** In-memory implementation (tests, offline evaluation). */
export function createMemoryAICacheRepository(): AICacheRepository & { entries: Map<string, AICacheEntry> } {
  const entries = new Map<string, AICacheEntry>();
  return {
    entries,
    get(cacheKey, now) {
      const entry = entries.get(cacheKey) ?? null;
      return Promise.resolve(entry && (entry.expiresAt === null || entry.expiresAt > now) ? structuredClone(entry) : null);
    },
    put(entry) {
      entries.set(entry.cacheKey, structuredClone(entry));
      return Promise.resolve();
    },
  };
}
