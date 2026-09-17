import {
  DEFAULT_EXERCISE_PREFERENCES, DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES, PREFERENCE_RANGES, QUESTION_TYPES,
  type ChildProfile, type CreateChildRequest, type ExercisePreferences, type ExplanationDifficulty, type Millis, type QuestionType,
  type ReadingLevel, type ReadingPreferences, type TTSPreferences,
} from '@aide/shared';

/** Avatar emoji offered to the child (labels in fr.parent.childEdit.avatars). */
export const AVATARS = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐙', '🦄', '🐢', '🐧', '🐨', '🐶', '🐱', '🦉', '🐝', '🚀', '⭐'] as const;

export interface ChildFormValues {
  firstName: string;
  age: number;
  avatar: string;
  readingLevel: ReadingLevel;
  explanationDifficulty: ExplanationDifficulty;
  reading: ReadingPreferences;
  tts: TTSPreferences;
  exercises: ExercisePreferences;
}

export type ChildFormField = 'firstName' | 'age' | 'avatar' | 'questionTypes';
export type ChildFormErrors = Partial<Record<ChildFormField, true>>;

export function emptyChildForm(): ChildFormValues {
  return {
    firstName: '',
    age: 10,
    avatar: AVATARS[0],
    readingLevel: 'intermediaire',
    explanationDifficulty: 'simple',
    reading: { ...DEFAULT_READING_PREFERENCES },
    tts: { ...DEFAULT_TTS_PREFERENCES },
    exercises: { ...DEFAULT_EXERCISE_PREFERENCES, enabledTypes: [...DEFAULT_EXERCISE_PREFERENCES.enabledTypes] },
  };
}

export function childToForm(child: ChildProfile): ChildFormValues {
  return {
    firstName: child.firstName,
    age: child.age,
    avatar: child.avatar,
    readingLevel: child.readingLevel,
    explanationDifficulty: child.explanationDifficulty,
    reading: { ...DEFAULT_READING_PREFERENCES, ...child.reading },
    tts: { ...DEFAULT_TTS_PREFERENCES, ...child.tts },
    exercises: { ...DEFAULT_EXERCISE_PREFERENCES, ...child.exercises, enabledTypes: [...child.exercises.enabledTypes] },
  };
}

export function validateChildForm(v: ChildFormValues): ChildFormErrors {
  const errors: ChildFormErrors = {};
  const name = v.firstName.trim();
  const r = PREFERENCE_RANGES;
  if (name.length < r.firstNameLength.min || name.length > r.firstNameLength.max) errors.firstName = true;
  if (!Number.isInteger(v.age) || v.age < r.childAge.min || v.age > r.childAge.max) errors.age = true;
  if (v.avatar.trim() === '' || v.avatar.length > 32) errors.avatar = true;
  if (v.exercises.enabledTypes.length === 0) errors.questionTypes = true;
  return errors;
}

/** Enabled types in canonical order, without duplicates. */
export function toggleQuestionType(types: readonly QuestionType[], type: QuestionType, enabled: boolean): QuestionType[] {
  const set = new Set(types);
  if (enabled) set.add(type);
  else set.delete(type);
  return QUESTION_TYPES.filter((t) => set.has(t));
}

export function formToCreateRequest(v: ChildFormValues): CreateChildRequest {
  return {
    firstName: v.firstName.trim(),
    age: v.age,
    avatar: v.avatar,
    readingLevel: v.readingLevel,
    explanationDifficulty: v.explanationDifficulty,
    reading: { ...v.reading },
    tts: { ...v.tts },
    exercises: { ...v.exercises, enabledTypes: [...v.exercises.enabledTypes] },
  };
}

export function formToProfile(child: ChildProfile, v: ChildFormValues, now: Millis): ChildProfile {
  return {
    ...child,
    ...formToCreateRequest(v),
    reading: { ...v.reading },
    tts: { ...v.tts },
    exercises: { ...v.exercises, enabledTypes: [...v.exercises.enabledTypes] },
    updatedAt: Math.max(now, child.updatedAt + 1),
  };
}

/** Rounds a slider value to the step precision (avoids 1.7000000000000002). */
export function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(value.toFixed(decimals));
}
