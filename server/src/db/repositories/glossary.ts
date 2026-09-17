import { type GlossaryEntry, GlossaryEntrySchema } from '@aide/shared';
import { type Db, type Row, parseJson } from './common';

/** Canonical headword: trimmed, NFC, lowercase (primary key with parent_id). */
export function normalizeHeadword(headword: string): string {
  return headword.trim().normalize('NFC').toLowerCase();
}

/** Parent glossary entries sorted by headword (used by the dictionary and the AI layer). */
export async function listGlossaryEntries(db: Db, parentId: string): Promise<GlossaryEntry[]> {
  const rows = (await db('glossary_entries').where('parent_id', parentId).orderBy('headword', 'asc')) as Row[];
  const entries: GlossaryEntry[] = [];
  for (const row of rows) {
    const parsed = GlossaryEntrySchema.safeParse(parseJson<unknown>(row.entry_json, null));
    if (parsed.success) entries.push(parsed.data);
  }
  return entries;
}

export async function saveGlossaryEntry(db: Db, parentId: string, entry: GlossaryEntry, now: number): Promise<GlossaryEntry> {
  const stored: GlossaryEntry = { ...entry, headword: normalizeHeadword(entry.headword) };
  await db('glossary_entries')
    .insert({ parent_id: parentId, headword: stored.headword, entry_json: JSON.stringify(stored), updated_at: now })
    .onConflict(['parent_id', 'headword'])
    .merge();
  return stored;
}

export async function deleteGlossaryEntry(db: Db, parentId: string, headword: string): Promise<boolean> {
  const n = await db('glossary_entries').where({ parent_id: parentId, headword: normalizeHeadword(headword) }).delete();
  return n > 0;
}
