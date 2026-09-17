// Uploaded originals (`document_files`) and processed page images (`document_page_images`), §15.6.
import { type Db, type Row, toNum, toStr } from './common';

export interface StoredFile {
  documentId: string;
  /** file_index for originals, page_index for page images. */
  index: number;
  parentId: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  /** Relative to the uploads root, always with forward slashes. */
  storagePath: string;
  updatedAt: number;
}

export type FileKind = 'original' | 'page_image';

const TABLES: Record<FileKind, { table: string; indexColumn: string; timeColumn: string }> = {
  original: { table: 'document_files', indexColumn: 'file_index', timeColumn: 'created_at' },
  page_image: { table: 'document_page_images', indexColumn: 'page_index', timeColumn: 'updated_at' },
};

function fromRow(kind: FileKind, row: Row): StoredFile {
  const t = TABLES[kind];
  return {
    documentId: toStr(row.document_id),
    index: toNum(row[t.indexColumn]),
    parentId: toStr(row.parent_id),
    name: kind === 'original' ? toStr(row.name) : `page-${toNum(row.page_index) + 1}`,
    mime: toStr(row.mime),
    size: toNum(row.size),
    sha256: toStr(row.sha256),
    storagePath: toStr(row.storage_path),
    updatedAt: toNum(row[t.timeColumn]),
  };
}

export async function findStoredFile(db: Db, kind: FileKind, parentId: string, documentId: string, index: number): Promise<StoredFile | null> {
  const t = TABLES[kind];
  const row = (await db(t.table).where({ parent_id: parentId, document_id: documentId, [t.indexColumn]: index }).first()) as Row | undefined;
  return row ? fromRow(kind, row) : null;
}

export async function listStoredFiles(db: Db, kind: FileKind, documentId: string): Promise<StoredFile[]> {
  const t = TABLES[kind];
  const rows = (await db(t.table).where('document_id', documentId)) as Row[];
  return rows.map((row) => fromRow(kind, row));
}

export async function saveStoredFile(db: Db, kind: FileKind, file: StoredFile): Promise<void> {
  const t = TABLES[kind];
  const base = {
    document_id: file.documentId,
    [t.indexColumn]: file.index,
    parent_id: file.parentId,
    mime: file.mime,
    size: file.size,
    sha256: file.sha256,
    storage_path: file.storagePath,
    [t.timeColumn]: file.updatedAt,
  };
  const row = kind === 'original' ? { ...base, name: file.name } : base;
  await db(t.table).insert(row).onConflict(['document_id', t.indexColumn]).merge();
}

export async function deleteStoredFiles(db: Db, kind: FileKind, documentId: string): Promise<number> {
  return db(TABLES[kind].table).where('document_id', documentId).delete();
}

/** Bytes stored for a parent (originals + page images), for the upload quota. */
export async function storageUsage(db: Db, parentId: string): Promise<number> {
  let total = 0;
  for (const kind of ['original', 'page_image'] as const) {
    const row = (await db(TABLES[kind].table).where('parent_id', parentId).sum({ total: 'size' }).first()) as { total: unknown } | undefined;
    total += toNum(row?.total);
  }
  return total;
}
