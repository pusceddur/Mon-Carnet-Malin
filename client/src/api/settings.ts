// Thin wrappers over §7 /api/settings and §17.5 /api/settings/worker.
import { WorkerStatusSchema, type ParentSettings, type WorkerStatus } from '@aide/shared';
import { api } from './http';

export const getSettings = (): Promise<ParentSettings> => api<ParentSettings>('GET', '/api/settings');
export const putSettings = (settings: ParentSettings): Promise<ParentSettings> => api<ParentSettings>('PUT', '/api/settings', settings);

/** GET /api/settings/worker: state of the home computer (« lecture intelligente »). Null when offline, on error or on an invalid answer. Never throws. */
export async function getWorkerStatus(signal?: AbortSignal): Promise<WorkerStatus | null> {
  try {
    const raw = await api<unknown>('GET', '/api/settings/worker', undefined, { signal, timeoutMs: 15_000 });
    const parsed = WorkerStatusSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
