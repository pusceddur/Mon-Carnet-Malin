// Thin wrappers over /api/documents (contract §7, §15.6).
import {
  DocumentTextModeResponseSchema, type DocumentTextMode, type DocumentTextModeResponse, type Id, type OkResponse, type ReadingPreparationRequest,
  type ReadingPreparationResponse, ReadingPreparationResponseSchema,
} from '@aide/shared';
import { ApiError, api } from './http';

const path = (id: Id): string => `/api/documents/${encodeURIComponent(id)}`;
const pageImagePath = (id: Id, pageIndex: number): string => `${path(id)}/pages/${pageIndex}/image`;

export const deleteDocument = (id: Id): Promise<OkResponse> => api<OkResponse>('DELETE', path(id));

/**
 * §17.10 « Texte écrit par un enfant » on/off (parent area unlocked, online). Resolves with the saved document and the number
 * of pages sent to the « lecture intelligente » again. Throws ApiError (`parent_locked`, `offline`, …).
 */
export async function setDocumentTextMode(id: Id, textMode: DocumentTextMode): Promise<DocumentTextModeResponse> {
  const raw = await api<unknown>('PUT', `${path(id)}/text-mode`, { textMode });
  const parsed = DocumentTextModeResponseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.document.id !== id) throw new ApiError(200, 'invalid_response', 'Invalid JSON response');
  return parsed.data;
}

/**
 * §22 « Préparer la lecture » (online): the page(s) on screen from the reader, or the whole document (Réglages unlocked) when
 * `pageIndexes` is omitted. Resolves with the number of pages sent to the home computer, or why it cannot prepare them.
 */
export async function prepareReading(id: Id, body: ReadingPreparationRequest = {}): Promise<ReadingPreparationResponse> {
  const raw = await api<unknown>('POST', `${path(id)}/reading-preparation`, body);
  const parsed = ReadingPreparationResponseSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(200, 'invalid_response', 'Invalid JSON response');
  return parsed.data;
}

/** Only when ParentSettings.privacy.uploadOriginals is true. Throws ApiError (404 `document_not_synced` before sync). */
export function uploadDocumentFile(id: Id, index: number, file: Blob, fileName: string): Promise<OkResponse> {
  const form = new FormData();
  form.append('index', String(index));
  form.append('file', file, fileName);
  return api<OkResponse>('POST', `${path(id)}/files`, undefined, { form, timeoutMs: 300_000 });
}

/** URL of an uploaded original (binary, not JSON: fetch it directly). */
export const documentFileUrl = (id: Id, index: number): string => `${path(id)}/files/${index}`;

/** GET /api/documents/:id/pages/:pageIndex/image: processed page image, null when absent or unreachable. Never throws. */
/** Page images the server does not have (404), remembered for a while so the Original view does not ask again on every render. */
const missingPageImages = new Map<string, number>();
export const MISSING_PAGE_IMAGE_TTL_MS = 5 * 60_000;

export async function fetchPageImage(documentId: Id, pageIndex: number, signal?: AbortSignal): Promise<Blob | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const key = `${documentId}:${pageIndex}`;
  const missingSince = missingPageImages.get(key);
  if (missingSince !== undefined && Date.now() - missingSince < MISSING_PAGE_IMAGE_TTL_MS) return null;
  try {
    const res = await fetch(pageImagePath(documentId, pageIndex), {
      method: 'GET',
      credentials: 'include',
      headers: { 'X-Requested-With': 'aide' },
      signal,
    });
    if (res.status === 404) missingPageImages.set(key, Date.now());
    if (!res.ok) return null;
    missingPageImages.delete(key);
    const blob = await res.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

/** PUT /api/documents/:id/pages/:pageIndex/image (only when privacy.uploadPageImages): JPEG without EXIF, ≤ 5 MB. Throws ApiError. */
export async function uploadPageImage(documentId: Id, pageIndex: number, blob: Blob): Promise<void> {
  const form = new FormData();
  form.append('image', blob, `page-${pageIndex}.jpg`);
  await api<OkResponse>('PUT', pageImagePath(documentId, pageIndex), undefined, { form, timeoutMs: 120_000 });
}
