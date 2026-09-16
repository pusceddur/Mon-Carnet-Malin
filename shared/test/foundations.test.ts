import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  AnnotationSchema, AnswerSchema, AuthStatusSchema, ChildProfileSchema, CorrectAnswerRequestSchema, DEFAULT_PARENT_SETTINGS,
  DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES, DEFAULT_EXERCISE_PREFERENCES, DictionaryResultSchema, DocumentMetaSchema,
  ExerciseSchema, ExplainWordRequestSchema, GenerateQuestionsRequestSchema, GlossaryEntrySchema, KID_MESSAGES, LIMITS,
  OcrServerResultSchema, PageContentSchema, ParentSettingsSchema, PROMPT_VERSION, QuestionOnTextRequestSchema, QuestionSchema,
  ReadingPreferencesSchema, ReadingProgressSchema, ReadingSessionSchema, SimplifyTextRequestSchema, SummarizeRequestSchema,
  SyncRequestSchema, SyncResponseSchema, ActivitySummarySchema, AIResultSchema, ExplanationDataSchema, ExplainTextRequestSchema,
  THICKNESS_EM, newId, sha256Hex, sha256HexSync,
} from '../src/index';
import type {
  ActivitySummary, AIResult, Annotation, Answer, AuthStatus, ChildProfile, CorrectAnswerRequest, DictionaryResult, DocumentMeta,
  Exercise, ExplainTextRequest, ExplainWordRequest, ExplanationData, GenerateQuestionsRequest, GlossaryEntry, OcrServerResult,
  PageContent, ParentSettings, Question, QuestionOnTextRequest, ReadingPreferences, ReadingProgress, ReadingSession,
  SimplifyTextRequest, SummarizeRequest, SyncRequest, SyncResponse,
} from '../src/index';

describe('shared foundations', () => {
  it('exposes constants', () => {
    expect(PROMPT_VERSION).toBe('2026-09-16.1');
    expect(LIMITS.chunkMaxChars).toBe(6000);
    expect(LIMITS.questionOnTextMaxChars).toBe(200);
    expect(KID_MESSAGES.notInText).toBe('Je ne trouve pas cette information dans le texte.');
    expect(THICKNESS_EM.highlighter.moyen).toBe(1.0);
    expect(DEFAULT_TTS_PREFERENCES.rate).toBe(0.85);
  });

  it('defaults validate against their schemas', () => {
    expect(ParentSettingsSchema.parse(DEFAULT_PARENT_SETTINGS)).toEqual(DEFAULT_PARENT_SETTINGS);
    expect(ReadingPreferencesSchema.parse(DEFAULT_READING_PREFERENCES)).toEqual(DEFAULT_READING_PREFERENCES);
    const child: ChildProfile = {
      id: newId(), parentId: newId(), firstName: 'Léo', age: 10, avatar: '🦊', readingLevel: 'intermediaire',
      explanationDifficulty: 'simple', reading: DEFAULT_READING_PREFERENCES, tts: DEFAULT_TTS_PREFERENCES,
      exercises: DEFAULT_EXERCISE_PREFERENCES, createdAt: 1, updatedAt: 1, deletedAt: null,
    };
    expect(ChildProfileSchema.parse(child)).toEqual(child);
  });

  it('newId returns a UUID v4 and sha256 matches the known vector', async () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await sha256Hex('abc')).toBe(abc);
    expect(sha256HexSync('abc')).toBe(abc);
    expect(sha256HexSync('é'.repeat(100))).toBe(await sha256Hex('é'.repeat(100)));
  });

  it('schemas infer exactly the contract types (compile-time)', () => {
    type Out<S extends z.ZodType> = z.output<S>;
    // Mutual assignability (expectTypeOf's deep brand does not handle object unions well).
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const explainResultSchema = AIResultSchema(ExplanationDataSchema);
    expectTypeOf<Same<Out<typeof ChildProfileSchema>, ChildProfile>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof DocumentMetaSchema>, DocumentMeta>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof PageContentSchema>, PageContent>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ReadingProgressSchema>, ReadingProgress>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ReadingSessionSchema>, ReadingSession>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof AnnotationSchema>, Annotation>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof QuestionSchema>, Question>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ExerciseSchema>, Exercise>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof AnswerSchema>, Answer>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ParentSettingsSchema>, ParentSettings>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof GlossaryEntrySchema>, GlossaryEntry>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof DictionaryResultSchema>, DictionaryResult>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ExplainWordRequestSchema>, ExplainWordRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ExplainTextRequestSchema>, ExplainTextRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof SimplifyTextRequestSchema>, SimplifyTextRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof SummarizeRequestSchema>, SummarizeRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof GenerateQuestionsRequestSchema>, GenerateQuestionsRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof CorrectAnswerRequestSchema>, CorrectAnswerRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof QuestionOnTextRequestSchema>, QuestionOnTextRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof explainResultSchema>, AIResult<ExplanationData>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof AuthStatusSchema>, AuthStatus>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof SyncRequestSchema>, SyncRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof SyncResponseSchema>, SyncResponse>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof OcrServerResultSchema>, OcrServerResult>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ActivitySummarySchema>, ActivitySummary>>().toEqualTypeOf<true>();
  });
});
