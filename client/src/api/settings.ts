// STUB: client-shell — thin wrappers over §7 /api/settings
import type { ParentSettings } from '@aide/shared';
import { api } from './http';

export const getSettings = (): Promise<ParentSettings> => api<ParentSettings>('GET', '/api/settings');
export const putSettings = (settings: ParentSettings): Promise<ParentSettings> => api<ParentSettings>('PUT', '/api/settings', settings);
