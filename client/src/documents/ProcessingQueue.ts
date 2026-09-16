// STUB: client-documents
import type { Id } from '@aide/shared';

export interface DocumentProgress { documentId: Id; total: number; ready: number; lowConfidence: number; failed: number; processingPageIndex: number | null; percent: number }

export const processingQueue: {
  start(): void;                                               // resumes persisted jobs (also after reload)
  subscribe(documentId: Id, cb: (p: DocumentProgress) => void): () => void;
  reprocessPage(documentId: Id, pageIndex: number, opts?: { useServer?: boolean; rotateDegrees?: 0 | 90 | 180 | 270; quad?: [number, number][] }): Promise<void>;
} = {
  start() {},
  subscribe(documentId, cb) {
    void documentId;
    void cb;
    return () => {};
  },
  async reprocessPage(documentId, pageIndex, opts) {
    void documentId;
    void pageIndex;
    void opts;
  },
};

/** React hook: live progress of a document, null when unknown. */
export function useDocumentProgress(documentId: Id): DocumentProgress | null {
  void documentId;
  return null;
}
