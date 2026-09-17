import { DEFAULT_PARENT_SETTINGS, type ParentSettings, ParentSettingsSchema } from '@aide/shared';
import { type Db, type Row, parseJson, toNum } from './common';

type Section = Exclude<keyof ParentSettings, 'updatedAt'>;
const SECTIONS: readonly Section[] = ['ai', 'ocr', 'privacy', 'safety', 'reader'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively keeps stored values whose type matches the default; unknown keys are dropped, missing keys get defaults. */
function mergeValue(defaults: unknown, stored: unknown): unknown {
  if (isPlainObject(defaults)) {
    const source = isPlainObject(stored) ? stored : {};
    const out: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(defaults)) out[key] = mergeValue(def, source[key]);
    return out;
  }
  if (stored === undefined || stored === null) return defaults;
  return typeof stored === typeof defaults ? stored : defaults;
}

/**
 * Stored settings (possibly partial, older or out of range) merged over DEFAULT_PARENT_SETTINGS.
 * A section that still fails validation is reset to its defaults.
 */
export function mergeParentSettings(stored: unknown, updatedAt = 0): ParentSettings {
  const merged = mergeValue(DEFAULT_PARENT_SETTINGS, stored) as Record<string, unknown>;
  const out: Record<string, unknown> = { updatedAt };
  for (const section of SECTIONS) {
    const parsed = ParentSettingsSchema.shape[section].safeParse(merged[section]);
    out[section] = parsed.success ? parsed.data : structuredClone(DEFAULT_PARENT_SETTINGS[section]);
  }
  return ParentSettingsSchema.parse(out);
}

/** Settings of a parent merged with defaults (never throws on stored data). Used by the AI layer. */
export async function getParentSettings(db: Db, parentId: string): Promise<ParentSettings> {
  const row = (await db('settings').where('parent_id', parentId).first()) as Row | undefined;
  if (!row) return mergeParentSettings(undefined, 0);
  return mergeParentSettings(parseJson<unknown>(row.settings_json, undefined), toNum(row.updated_at));
}

export async function saveParentSettings(db: Db, parentId: string, settings: ParentSettings): Promise<void> {
  const { updatedAt, ...rest } = settings;
  await db('settings')
    .insert({ parent_id: parentId, settings_json: JSON.stringify(rest), updated_at: updatedAt })
    .onConflict('parent_id')
    .merge();
}
