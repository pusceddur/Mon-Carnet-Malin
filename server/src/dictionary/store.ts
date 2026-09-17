import { GlossaryEntrySchema, type GlossaryEntry } from '@aide/shared';
import type { Knex } from 'knex';
import { z } from 'zod';

/** Upper bound of parent glossary rows loaded per lookup (a family glossary is small). */
const PARENT_GLOSSARY_MAX_ROWS = 5_000;

/** Stored in dictionary_cache.result_json; the kid-friendly text is recomputed on read. */
export const CachedLookupSchema = z.discriminatedUnion('status', [
  z.object({
    v: z.literal(1),
    status: z.literal('found'),
    headword: z.string().min(1),
    lemma: z.string().min(1),
    partOfSpeech: z.string().nullable(),
    definition: z.string().min(1),
    pageTitle: z.string().min(1),
  }),
  z.object({ v: z.literal(1), status: z.literal('not_found') }),
]);
export type CachedLookup = z.infer<typeof CachedLookupSchema>;

export interface CacheRow {
  record: CachedLookup;
  fetchedAt: number;
}

export async function loadParentGlossary(db: Knex, parentId: string): Promise<GlossaryEntry[]> {
  const rows = (await db('glossary_entries')
    .select('entry_json')
    .where({ parent_id: parentId })
    .limit(PARENT_GLOSSARY_MAX_ROWS)) as { entry_json: string }[];
  const entries: GlossaryEntry[] = [];
  for (const row of rows) {
    try {
      const parsed = GlossaryEntrySchema.safeParse(JSON.parse(row.entry_json));
      if (parsed.success) entries.push(parsed.data);
    } catch {
      // Corrupted row: ignored.
    }
  }
  return entries;
}

export async function readDictionaryCache(db: Knex, word: string): Promise<CacheRow | null> {
  const row = (await db('dictionary_cache').select('result_json', 'fetched_at').where({ word }).first()) as
    | { result_json: string; fetched_at: number | string }
    | undefined;
  if (!row) return null;
  try {
    const parsed = CachedLookupSchema.safeParse(JSON.parse(row.result_json));
    const fetchedAt = Number(row.fetched_at);
    if (!parsed.success || !Number.isFinite(fetchedAt)) return null;
    return { record: parsed.data, fetchedAt };
  } catch {
    return null;
  }
}

export async function writeDictionaryCache(db: Knex, word: string, record: CachedLookup, fetchedAt: number): Promise<void> {
  await db('dictionary_cache')
    .insert({ word, result_json: JSON.stringify(record), fetched_at: fetchedAt })
    .onConflict('word')
    .merge(['result_json', 'fetched_at']);
}
