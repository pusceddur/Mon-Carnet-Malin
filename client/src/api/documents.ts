// STUB: client-documents — thin wrappers over §7 /api/documents
import type { Id, OkResponse } from '@aide/shared';
import { api } from './http';

const path = (id: Id): string => `/api/documents/${encodeURIComponent(id)}`;

export const deleteDocument = (id: Id): Promise<OkResponse> => api<OkResponse>('DELETE', path(id));

/** Only when ParentSettings.privacy.uploadOriginals is true. */
export function uploadDocumentFile(id: Id, index: number, file: Blob, fileName: string): Promise<OkResponse> {
  const form = new FormData();
  form.append('index', String(index));
  form.append('file', file, fileName);
  return api<OkResponse>('POST', `${path(id)}/files`, undefined, { form, timeoutMs: 300_000 });
}

/** URL of an uploaded original (binary, not JSON: fetch it directly). */
export const documentFileUrl = (id: Id, index: number): string => `${path(id)}/files/${index}`;
