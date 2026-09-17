import {
  type ChildProfile, type CreateChildRequest, DEFAULT_EXERCISE_PREFERENCES, DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES,
  ExercisePreferencesSchema, type ExplanationDifficulty, type ExercisePreferences, ExplanationDifficultySchema, newId,
  ReadingLevelSchema, type ReadingLevel, type ReadingPreferences, ReadingPreferencesSchema, type TTSPreferences, TTSPreferencesSchema,
} from '@aide/shared';
import type { z } from 'zod';
import { type Db, type Row, parseJson, toNum, toNumOrNull, toStr } from './common';

export const DEFAULT_CHILD_AGE = 10;
export const DEFAULT_CHILD_AVATAR = '🦊';
export const DEFAULT_READING_LEVEL: ReadingLevel = 'intermediaire';
export const DEFAULT_EXPLANATION_DIFFICULTY: ExplanationDifficulty = 'simple';

interface StoredPreferences { reading?: unknown; tts?: unknown; exercises?: unknown }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stored partial/older preferences merged over defaults; an invalid result falls back to the defaults. */
function withDefaults<S extends z.ZodType>(schema: S, defaults: z.output<S>, stored: unknown): z.output<S> {
  const merged = isPlainObject(stored) ? { ...(defaults as Record<string, unknown>), ...stored } : defaults;
  const parsed = schema.safeParse(merged);
  return parsed.success ? parsed.data : defaults;
}

export function mergeReadingPreferences(stored: unknown): ReadingPreferences {
  return withDefaults(ReadingPreferencesSchema, DEFAULT_READING_PREFERENCES, stored);
}

export function mergeTtsPreferences(stored: unknown): TTSPreferences {
  return withDefaults(TTSPreferencesSchema, DEFAULT_TTS_PREFERENCES, stored);
}

export function mergeExercisePreferences(stored: unknown): ExercisePreferences {
  return withDefaults(ExercisePreferencesSchema, DEFAULT_EXERCISE_PREFERENCES, stored);
}

export function childFromRow(row: Row): ChildProfile {
  const prefs = parseJson<StoredPreferences>(row.preferences_json, {});
  const level = ReadingLevelSchema.safeParse(row.reading_level);
  const difficulty = ExplanationDifficultySchema.safeParse(row.explanation_difficulty);
  return {
    id: toStr(row.id),
    parentId: toStr(row.parent_id),
    firstName: toStr(row.first_name),
    age: toNum(row.age),
    avatar: toStr(row.avatar),
    readingLevel: level.success ? level.data : DEFAULT_READING_LEVEL,
    explanationDifficulty: difficulty.success ? difficulty.data : DEFAULT_EXPLANATION_DIFFICULTY,
    reading: mergeReadingPreferences(prefs.reading),
    tts: mergeTtsPreferences(prefs.tts),
    exercises: mergeExercisePreferences(prefs.exercises),
    createdAt: toNum(row.created_at),
    updatedAt: toNum(row.updated_at),
    deletedAt: toNumOrNull(row.deleted_at),
  };
}

export async function listChildren(db: Db, parentId: string, opts: { includeDeleted?: boolean } = {}): Promise<ChildProfile[]> {
  const query = db('children').where('parent_id', parentId).orderBy('created_at', 'asc');
  if (!opts.includeDeleted) query.whereNull('deleted_at');
  const rows = (await query) as Row[];
  return rows.map(childFromRow);
}

/**
 * Child of this parent, or null (also null when soft-deleted unless `includeDeleted`).
 * Used by the AI layer to check that a request's child belongs to the authenticated parent.
 */
export async function getChild(db: Db, parentId: string, childId: string, opts: { includeDeleted?: boolean } = {}): Promise<ChildProfile | null> {
  const row = (await db('children').where({ id: childId, parent_id: parentId }).first()) as Row | undefined;
  if (!row) return null;
  const child = childFromRow(row);
  return child.deletedAt !== null && !opts.includeDeleted ? null : child;
}

/** Child by primary key regardless of owner (ownership checks in sync). */
export async function findChildById(db: Db, childId: string): Promise<ChildProfile | null> {
  const row = (await db('children').where('id', childId).first()) as Row | undefined;
  return row ? childFromRow(row) : null;
}

export function buildNewChild(parentId: string, req: CreateChildRequest, now: number): ChildProfile {
  return {
    id: newId(),
    parentId,
    firstName: req.firstName,
    age: req.age ?? DEFAULT_CHILD_AGE,
    avatar: req.avatar ?? DEFAULT_CHILD_AVATAR,
    readingLevel: req.readingLevel ?? DEFAULT_READING_LEVEL,
    explanationDifficulty: req.explanationDifficulty ?? DEFAULT_EXPLANATION_DIFFICULTY,
    reading: mergeReadingPreferences(req.reading),
    tts: mergeTtsPreferences(req.tts),
    exercises: mergeExercisePreferences(req.exercises),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

/** Insert or replace a child row (caller has checked ownership). */
export async function saveChild(db: Db, child: ChildProfile, serverSeq: number): Promise<void> {
  await db('children')
    .insert({
      id: child.id,
      parent_id: child.parentId,
      first_name: child.firstName,
      age: child.age,
      avatar: child.avatar,
      reading_level: child.readingLevel,
      explanation_difficulty: child.explanationDifficulty,
      preferences_json: JSON.stringify({ reading: child.reading, tts: child.tts, exercises: child.exercises }),
      created_at: child.createdAt,
      updated_at: child.updatedAt,
      deleted_at: child.deletedAt,
      server_seq: serverSeq,
    })
    .onConflict('id')
    .merge();
}
