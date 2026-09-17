import { DEFAULT_PARENT_SETTINGS, type ParentSettings } from '@aide/shared';

/** Merges a server/cached value over the defaults so settings saved by an older version stay complete. */
export function completeSettings(settings: Partial<ParentSettings> | null | undefined): ParentSettings {
  const d = DEFAULT_PARENT_SETTINGS;
  if (!settings) return structuredClone(d);
  return {
    ai: { ...d.ai, ...settings.ai, features: { ...d.ai.features, ...settings.ai?.features } },
    ocr: { ...d.ocr, ...settings.ocr },
    privacy: { ...d.privacy, ...settings.privacy },
    safety: { ...d.safety, ...settings.safety },
    reader: { ...d.reader, ...settings.reader },
    updatedAt: settings.updatedAt ?? 0,
  };
}

export function sameSettings(a: ParentSettings, b: ParentSettings): boolean {
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });
}
