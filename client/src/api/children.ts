// Thin wrappers over §7 /api/children.
import type { ChildProfile, CreateChildRequest, Id, OkResponse, UpdatePreferencesRequest } from '@aide/shared';
import { api } from './http';

const path = (id: Id): string => `/api/children/${encodeURIComponent(id)}`;

export const listChildren = (): Promise<ChildProfile[]> => api<ChildProfile[]>('GET', '/api/children');
export const createChild = (body: CreateChildRequest): Promise<ChildProfile> => api<ChildProfile>('POST', '/api/children', body);
export const updateChild = (child: ChildProfile): Promise<ChildProfile> => api<ChildProfile>('PUT', path(child.id), child);
export const updateChildPreferences = (id: Id, body: UpdatePreferencesRequest): Promise<ChildProfile> =>
  api<ChildProfile>('PATCH', `${path(id)}/preferences`, body);
export const deleteChild = (id: Id): Promise<OkResponse> => api<OkResponse>('DELETE', path(id));
