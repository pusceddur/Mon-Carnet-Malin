// writing_corrections (§24): every text corrected with « Corriger », with what changed, for the adult who works on writing
// with the child (never shown back to the child as a list). Kept one year.
import {
  newId, TEXT_BOX_MAX_CHARS, type WritingChange, type WritingChangeKind, type WritingCorrectionEntry, type WritingCorrectionHistory,
} from '@aide/shared';
import { type Db, parseJson, type Row, toNum, toStr, toStrOrNull } from './common';

const TABLE = 'writing_corrections';

export const WRITING_CORRECTIONS_RETENTION_MS = 365 * 24 * 60 * 60_000;
/** Corrections read to count the kinds and the frequent mistakes. */
const HISTORY_SCAN_MAX = 2000;
const FREQUENT_MAX = 10;
const KINDS: readonly WritingChangeKind[] = ['accent', 'orthographe', 'grammaire', 'ponctuation', 'majuscule', 'espace'];
/** Mistakes of the words themselves: the end of a sentence (full stop, capital) is not « the same mistake again ». */
const WORD_KINDS: ReadonlySet<WritingChangeKind> = new Set(['accent', 'orthographe', 'grammaire', 'espace']);

export interface WritingCorrectionRecord {
  parentId: string;
  childId: string;
  documentId: string | null;
  annotationId: string | null;
  originalText: string;
  correctedText: string;
  changes: WritingChange[];
  createdAt: number;
}

export interface WritingCorrectionsRepository {
  insert(record: WritingCorrectionRecord): Promise<void>;
}

export function createWritingCorrectionsRepository(db: Db): WritingCorrectionsRepository {
  return {
    async insert(record) {
      await db(TABLE).insert({
        id: newId(),
        parent_id: record.parentId,
        child_id: record.childId,
        document_id: record.documentId,
        annotation_id: record.annotationId,
        original_text: record.originalText.slice(0, TEXT_BOX_MAX_CHARS),
        corrected_text: record.correctedText.slice(0, TEXT_BOX_MAX_CHARS * 2),
        changes_json: JSON.stringify(record.changes),
        created_at: record.createdAt,
      });
    },
  };
}

export function createMemoryWritingCorrectionsRepository(): WritingCorrectionsRepository & { records: WritingCorrectionRecord[] } {
  const records: WritingCorrectionRecord[] = [];
  return {
    records,
    insert(record) {
      records.push(record);
      return Promise.resolve();
    },
  };
}

function entryFromRow(row: Row): WritingCorrectionEntry {
  const changes = parseJson<unknown>(row.changes_json, []);
  return {
    id: toStr(row.id),
    childId: toStr(row.child_id),
    documentId: toStrOrNull(row.document_id),
    originalText: toStr(row.original_text),
    correctedText: toStr(row.corrected_text),
    changes: Array.isArray(changes) ? (changes as WritingChange[]) : [],
    createdAt: toNum(row.created_at),
  };
}

/**
 * Corrections of one child of `parentId` since `since`: the `limit` newest ones, the number of corrections per kind and the
 * word mistakes made at least twice (same words, whatever the capitals).
 */
export async function writingCorrectionHistory(
  db: Db, parentId: string, childId: string, opts: { since: number; limit: number },
): Promise<WritingCorrectionHistory> {
  const rows = (await db(TABLE)
    .select('id', 'child_id', 'document_id', 'original_text', 'corrected_text', 'changes_json', 'created_at')
    .where({ parent_id: parentId, child_id: childId })
    .andWhere('created_at', '>=', opts.since)
    .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }])
    .limit(HISTORY_SCAN_MAX)) as Row[];
  const all = rows.map(entryFromRow);
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<WritingChangeKind, number>;
  const repeated = new Map<string, { from: string; to: string; kind: WritingChangeKind; count: number }>();
  for (const entry of all) {
    for (const change of entry.changes) {
      if (!KINDS.includes(change.kind)) continue;
      counts[change.kind] += 1;
      if (!WORD_KINDS.has(change.kind)) continue;
      const key = `${change.from.toLowerCase()}\u0000${change.to.toLowerCase()}`;
      const seen = repeated.get(key);
      if (seen) seen.count += 1;
      else repeated.set(key, { from: change.from, to: change.to, kind: change.kind, count: 1 });
    }
  }
  const frequent = [...repeated.values()]
    .filter((m) => m.count >= 2)
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from))
    .slice(0, FREQUENT_MAX);
  return { entries: all.slice(0, opts.limit), counts, frequent };
}

export async function deleteWritingCorrectionsBefore(db: Db, cutoff: number): Promise<number> {
  return db(TABLE).where('created_at', '<', cutoff).delete();
}
