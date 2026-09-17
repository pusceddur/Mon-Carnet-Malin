import type { PageContent, TextBlock, TextHighlight } from '@aide/shared';

export function makePage(pageIndex: number, blocks: readonly (TextBlock | string)[], overrides: Partial<PageContent> = {}): PageContent {
  return {
    documentId: 'doc-1',
    pageIndex,
    status: 'ready',
    textSource: 'pdf-text',
    blocks: blocks.map((b) => (typeof b === 'string' ? { kind: 'paragraph' as const, text: b } : b)),
    confidence: null,
    contentHash: null,
    width: 1000,
    height: 1400,
    warnings: [],
    updatedAt: 1,
    ...overrides,
  };
}

export function makeHighlight(overrides: Partial<TextHighlight>): TextHighlight {
  return {
    id: 'h1', type: 'highlight', childId: 'child-1', documentId: 'doc-1', color: '#fde047', pageIndex: 0, blockIndex: 0, start: 0, end: 2,
    blockTextHash: '', text: '', createdAt: 1, updatedAt: 1, deletedAt: null,
    ...overrides,
  };
}
