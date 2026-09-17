// Reading comfort preferences: applied immediately, saved with PATCH /api/children/:id/preferences when online,
// otherwise (or on failure) written locally through saveEntity so the sync pushes them later (§15.2: reading/tts only).
import {
  DEFAULT_READING_PREFERENCES,
  DEFAULT_TTS_PREFERENCES,
  type ChildProfile,
  type Id,
  type ReadingPreferences,
  type TTSPreferences,
} from '@aide/shared';
import { updateChildPreferences } from '../../api/children';
import { db } from '../../db/localDb';
import { isOnline } from '../../platform/online';
import { useSessionStore } from '../../state/session';
import { applyRemote, saveEntity } from '../../sync/SyncEngine';

export interface PreferencesPatch { reading?: Partial<ReadingPreferences>; tts?: Partial<TTSPreferences> }

export function mergePatch(a: PreferencesPatch, b: PreferencesPatch): PreferencesPatch {
  const out: PreferencesPatch = {};
  if (a.reading || b.reading) out.reading = { ...a.reading, ...b.reading };
  if (a.tts || b.tts) out.tts = { ...a.tts, ...b.tts };
  return out;
}

export function isEmptyPatch(patch: PreferencesPatch): boolean {
  return Object.keys(patch.reading ?? {}).length === 0 && Object.keys(patch.tts ?? {}).length === 0;
}

export function effectiveReading(child: Pick<ChildProfile, 'reading'> | null, override: PreferencesPatch): ReadingPreferences {
  return { ...DEFAULT_READING_PREFERENCES, ...child?.reading, ...override.reading };
}

export function effectiveTts(child: Pick<ChildProfile, 'tts'> | null, override: PreferencesPatch): TTSPreferences {
  return { ...DEFAULT_TTS_PREFERENCES, ...child?.tts, ...override.tts };
}

export function applyPatch(child: ChildProfile, patch: PreferencesPatch, now: number): ChildProfile {
  return { ...child, reading: { ...child.reading, ...patch.reading }, tts: { ...child.tts, ...patch.tts }, updatedAt: Math.max(now, child.updatedAt + 1) };
}

export interface PreferencesDeps {
  loadChild(childId: Id): Promise<ChildProfile | null>;
  online(): boolean;
  patchServer(childId: Id, patch: PreferencesPatch): Promise<ChildProfile>;
  storeRemote(child: ChildProfile): Promise<void>;
  storeLocal(child: ChildProfile): Promise<void>;
  publish(child: ChildProfile): void;
  now(): number;
}

const defaultDeps: PreferencesDeps = {
  async loadChild(childId) {
    const fromStore = useSessionStore.getState().children.find((c) => c.id === childId);
    if (fromStore) return fromStore;
    try {
      return (await db.children.get(childId)) ?? null;
    } catch {
      return null;
    }
  },
  online: isOnline,
  patchServer: (childId, patch) => updateChildPreferences(childId, patch),
  storeRemote: (child) => applyRemote('children', [child]),
  storeLocal: (child) => saveEntity('children', child),
  publish(child) {
    const { children, setChildren } = useSessionStore.getState();
    if (children.some((c) => c.id === child.id)) setChildren(children.map((c) => (c.id === child.id ? child : c)));
  },
  now: Date.now,
};

/** Never throws. Returns where the preferences were saved. */
export async function savePreferences(childId: Id, patch: PreferencesPatch, deps: PreferencesDeps = defaultDeps): Promise<'server' | 'local' | 'failed' | 'skipped'> {
  if (isEmptyPatch(patch)) return 'skipped';
  try {
    const child = await deps.loadChild(childId);
    if (!child) return 'failed';
    const updated = applyPatch(child, patch, deps.now());
    deps.publish(updated);
    if (deps.online()) {
      try {
        const fromServer = await deps.patchServer(childId, patch);
        await deps.storeRemote(fromServer);
        deps.publish(fromServer);
        return 'server';
      } catch {
        // Offline in practice, or the server refused: keep the change locally and let the sync push it.
      }
    }
    await deps.storeLocal(updated);
    return 'local';
  } catch {
    return 'failed';
  }
}
