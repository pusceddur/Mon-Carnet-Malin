// Source image shown in the page editor: the original photo / PDF page when it is on this device, otherwise the
// processed image (local or server copy). Rotation and frame chosen in the editor are relative to this image.
import type { Id } from '@aide/shared';
import { useEffect, useState } from 'react';
import { decodeToRgba, encodeRgbaJpeg } from '../../ocr/preprocess/canvas';
import type { QuarterTurn } from '../../ocr/preprocess/geometry';
import { getDocumentFile, getJob, loadProcessedPageImage } from '../DocumentCache';
import { detectFileKind } from '../DocumentParser';
import { openPdf } from '../PDFReader';

export const EDITOR_PREVIEW_SIDE = 1600;

export interface PageSourceImage {
  blob: Blob;
  kind: 'original' | 'processed';
}

export async function loadPageSourceImage(documentId: Id, pageIndex: number): Promise<PageSourceImage | null> {
  const job = await getJob(documentId, pageIndex);
  if (job?.source) {
    const file = await getDocumentFile(documentId, job.source.fileIndex);
    const kind = file ? detectFileKind({ type: file.mime, name: file.name }) : null;
    if (file && kind === 'image') return { blob: file.blob, kind: 'original' };
    if (file && kind === 'pdf') {
      try {
        const pdf = await openPdf(file.blob);
        try {
          const rgba = await pdf.renderPage(job.source.pdfPageIndex ?? 0, EDITOR_PREVIEW_SIDE);
          return { blob: await encodeRgbaJpeg(rgba, 0.85), kind: 'original' };
        } finally {
          await pdf.destroy();
        }
      } catch {
        // Fall back to the processed image.
      }
    }
  }
  const processed = await loadProcessedPageImage(documentId, pageIndex);
  return processed ? { blob: processed, kind: 'processed' } : null;
}

export type LoadState<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'missing' };

/** Reloads when `version` changes (e.g. the page was reprocessed). */
export function usePageSourceImage(documentId: Id | undefined, pageIndex: number, version: unknown): LoadState<PageSourceImage> {
  const [state, setState] = useState<LoadState<PageSourceImage>>({ status: 'loading' });
  useEffect(() => {
    if (!documentId) {
      setState({ status: 'missing' });
      return;
    }
    let cancelled = false;
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    loadPageSourceImage(documentId, pageIndex).then(
      (value) => {
        if (!cancelled) setState(value ? { status: 'ready', value } : { status: 'missing' });
      },
      () => {
        if (!cancelled) setState({ status: 'missing' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [documentId, pageIndex, version]);
  return state;
}

/** Object URL of the image rotated by a quarter turn, sized for the screen; revoked automatically. */
export function useRotatedPreview(blob: Blob | null, rotation: QuarterTurn): LoadState<string> {
  const [state, setState] = useState<LoadState<string>>({ status: 'loading' });
  useEffect(() => {
    if (!blob) {
      setState({ status: 'missing' });
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    setState({ status: 'loading' });
    (async () => {
      const rgba = await decodeToRgba(blob, EDITOR_PREVIEW_SIDE, rotation);
      const jpeg = await encodeRgbaJpeg(rgba, 0.85);
      if (cancelled) return;
      url = URL.createObjectURL(jpeg);
      setState({ status: 'ready', value: url });
    })().catch(() => {
      if (!cancelled) setState({ status: 'missing' });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob, rotation]);
  return state;
}
