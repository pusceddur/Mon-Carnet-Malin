import type { PageContent, PageStatus, PageTextSource, PageWarning, TextBlock } from '@aide/shared';
import { type Db, type Row, parseJson, toNum, toNumOrNull, toStr, toStrOrNull } from './common';

export function pageFromRow(row: Row): PageContent {
  const blocks = parseJson<unknown>(row.blocks_json, []);
  const warnings = parseJson<unknown>(row.warnings_json, []);
  return {
    documentId: toStr(row.document_id),
    pageIndex: toNum(row.page_index),
    status: toStr(row.status) as PageStatus,
    textSource: toStrOrNull(row.text_source) as PageTextSource | null,
    blocks: Array.isArray(blocks) ? (blocks as TextBlock[]) : [],
    confidence: toNumOrNull(row.confidence),
    contentHash: toStrOrNull(row.content_hash),
    width: toNumOrNull(row.width),
    height: toNumOrNull(row.height),
    warnings: Array.isArray(warnings) ? (warnings as PageWarning[]) : [],
    updatedAt: toNum(row.updated_at),
  };
}

export async function findPage(db: Db, documentId: string, pageIndex: number): Promise<{ parentId: string; page: PageContent } | null> {
  const row = (await db('document_pages').where({ document_id: documentId, page_index: pageIndex }).first()) as Row | undefined;
  return row ? { parentId: toStr(row.parent_id), page: pageFromRow(row) } : null;
}

export async function savePage(db: Db, parentId: string, page: PageContent, serverSeq: number): Promise<void> {
  await db('document_pages')
    .insert({
      document_id: page.documentId,
      page_index: page.pageIndex,
      parent_id: parentId,
      status: page.status,
      text_source: page.textSource,
      blocks_json: JSON.stringify(page.blocks),
      confidence: page.confidence,
      content_hash: page.contentHash,
      width: page.width,
      height: page.height,
      warnings_json: JSON.stringify(page.warnings),
      updated_at: page.updatedAt,
      server_seq: serverSeq,
    })
    .onConflict(['document_id', 'page_index'])
    .merge();
}

const ISSUE_STATUSES: readonly PageStatus[] = ['low_confidence', 'failed'];
const ISSUE_WARNINGS: readonly PageWarning[] = ['low_confidence', 'no_text_found', 'suspicious_instructions'];

/** Pages with OCR problems of non-deleted documents (parent activity view). */
export async function listOcrIssues(
  db: Db,
  parentId: string,
  opts: { childId?: string; limit?: number } = {},
): Promise<{ documentId: string; pageIndex: number; confidence: number | null; warnings: PageWarning[] }[]> {
  const rows = (await db('document_pages as p')
    .join('documents as d', 'd.id', 'p.document_id')
    .select('p.document_id', 'p.page_index', 'p.status', 'p.confidence', 'p.warnings_json', 'd.child_ids_json')
    .where('p.parent_id', parentId)
    .andWhere('d.parent_id', parentId)
    .whereNull('d.deleted_at')
    .andWhere((q) => {
      q.whereIn('p.status', [...ISSUE_STATUSES]);
      for (const w of ISSUE_WARNINGS) q.orWhere('p.warnings_json', 'like', `%"${w}"%`);
    })
    .orderBy([{ column: 'p.updated_at', order: 'desc' }])
    .limit(opts.limit ?? 500)) as Row[];
  return rows
    .filter((row) => {
      if (!opts.childId) return true;
      const childIds = parseJson<unknown>(row.child_ids_json, []);
      return Array.isArray(childIds) && childIds.includes(opts.childId);
    })
    .map((row) => {
      const warnings = parseJson<unknown>(row.warnings_json, []);
      return {
        documentId: toStr(row.document_id),
        pageIndex: toNum(row.page_index),
        confidence: toNumOrNull(row.confidence),
        warnings: Array.isArray(warnings) ? (warnings as PageWarning[]) : [],
      };
    });
}
