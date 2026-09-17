// Thin wrappers over §7 /api/glossary.
import type { GlossaryEntry, OkResponse } from '@aide/shared';
import { api } from './http';

const path = (headword: string): string => `/api/glossary/${encodeURIComponent(headword)}`;

export const listGlossary = (): Promise<GlossaryEntry[]> => api<GlossaryEntry[]>('GET', '/api/glossary');
export const putGlossaryEntry = (entry: GlossaryEntry): Promise<GlossaryEntry> => api<GlossaryEntry>('PUT', path(entry.headword), entry);
export const deleteGlossaryEntry = (headword: string): Promise<OkResponse> => api<OkResponse>('DELETE', path(headword));
