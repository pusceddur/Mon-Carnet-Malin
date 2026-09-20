import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  AI_DEADLINES, AIDataSchemaByOperation, AIJobAcceptedSchema, AIJobPollSchema, AILearnerSchema, AIOperationSchema,
  AIRequestSchemaByOperation, AnnotationSchema, AnswerSchema, AuthStatusSchema, CAPITALIZED_COMMON, ChildProfileSchema,
  ChunkSummaryDataSchema, CorrectAnswerRequestSchema, DEFAULT_PARENT_SETTINGS, DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES,
  DEFAULT_EXERCISE_PREFERENCES, DictionaryResultSchema, DocumentMetaSchema, DocumentTextModeRequestSchema,
  DocumentTextModeResponseSchema, ExerciseSchema, ExplainWordRequestSchema,
  GenerateQuestionsRequestSchema, GlossaryEntrySchema, HandwritingDataSchema, HealthStatusSchema, InkSpaceSchema, InvitationConfigSchema, ClientDiagnosticReportSchema, ClientDiagnosticsRequestSchema,
  InviteCodeSchema, KID_MESSAGES, ParentUserSchema, RegisterRequestSchema, UpdateInvitationRequestSchema,
  LIMITS, OcrServerResultSchema, PageContentSchema, ParentSettingsSchema, PIN_DEFAULT_DIGITS, PROMPT_VERSION,
  QuestionOnTextRequestSchema, QuestionSchema, ReadingPreferencesSchema, ReadingProgressSchema, ReadingSessionSchema,
  RecognizeHandwritingRequestSchema, SetupRequestSchema, SimplifyTextRequestSchema, SummarizeRequestSchema, SummarizeStageSchema,
  SyncRejectionSchema, SyncRequestSchema, SyncResponseSchema, SyncTableSchema, ActivitySummarySchema, AIResultSchema,
  ExplanationDataSchema, ExplainTextRequestSchema, TextChunkSchema, THICKNESS_EM, TIMINGS, TTSPreferencesSchema,
  isAIOperationEnabled, newId, planHash, routeFor, sha256Hex, sha256HexSync, syncEntityKey,
} from '../src/index';
import type {
  ActivitySummary, AIDataByOperation, AIJobAccepted, AIJobPoll, AILearner, AIOperation, AIRequestByOperation, AIResult, Annotation,
  Answer, AuthStatus, ChildProfile, ChunkSummaryData, CorrectAnswerRequest, DictionaryResult, DocumentMeta, DocumentTextModeRequest,
  DocumentTextModeResponse, Exercise,
  ExplainTextRequest, ExplainWordRequest, ExplanationData, GenerateQuestionsRequest, GlossaryEntry, HandwritingData, HealthStatus,
  InkSpace, InvitationConfig, ClientDiagnosticReport, ClientDiagnosticsRequest, OcrServerResult, PageContent, ParentSettings, ParentUser, Question, QuestionOnTextRequest, ReadingPreferences, ReadingProgress,
  ReadingSession, RecognizeHandwritingRequest, SimplifyTextRequest, SummarizeRequest, SummarizeStage, SummaryData, SyncRejection,
  SyncRequest, SyncResponse, SyncTable, TextChunk, TTSPreferences,
} from '../src/index';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function settingsWith(patch: Partial<ParentSettings['ai']>): Pick<ParentSettings, 'ai'> {
  return { ai: { ...DEFAULT_PARENT_SETTINGS.ai, ...patch } };
}

describe('shared foundations', () => {
  it('exposes constants', () => {
    expect(PROMPT_VERSION).toBe('2026-09-16.1');
    expect(LIMITS.chunkMaxChars).toBe(6000);
    expect(LIMITS.questionOnTextMaxChars).toBe(200);
    expect(KID_MESSAGES.notInText).toBe('Je ne trouve pas cette information dans le texte.');
    expect(THICKNESS_EM.highlighter.moyen).toBe(1.0);
    expect(DEFAULT_TTS_PREFERENCES.rate).toBe(0.85);
  });

  it('exposes the v1.1 constants (§15)', () => {
    expect(DEFAULT_TTS_PREFERENCES).toEqual({ rate: 0.85, pitch: 1, sentencePauseMs: 250, paragraphPauseMs: 700 });
    expect(KID_MESSAGES.budget).toBe("Tu as beaucoup travaillé ce mois-ci ! L'aide revient bientôt.");
    expect(KID_MESSAGES.strict).toBe("Demande à un adulte de t'aider pour ce passage.");
    expect(PIN_DEFAULT_DIGITS).toBe(6);
    expect(LIMITS.pinMinDigits).toBeLessThanOrEqual(PIN_DEFAULT_DIGITS);
    expect(LIMITS.pinMaxDigits).toBeGreaterThanOrEqual(PIN_DEFAULT_DIGITS);
    expect(LIMITS.syncBodyMaxBytes).toBe(25 * 1024 * 1024);
    expect(LIMITS.jsonBodyMaxBytes).toBe(2 * 1024 * 1024);
    expect(LIMITS.simplifyMinRatio).toBe(0.3);
    expect(LIMITS.simplifyMaxRatio).toBe(1.5);
    expect(LIMITS.simplifyMaxExtraWords).toBe(12);
    expect(LIMITS.summarizeChunkParallelism).toBe(2);
    expect(LIMITS.retrieveMaxChars).toBe(12000);
    expect(TIMINGS).toMatchObject({ aiJobPollMs: 3000, penActiveGraceMs: 500, ttsWatchdogMs: 3000 });
    expect(TIMINGS).not.toHaveProperty('heartbeatIntervalMs');
    expect(AI_DEADLINES).toEqual({ light: 40_000, complex: 170_000 });
    expect(CAPITALIZED_COMMON.has('soleil')).toBe(true);
    // A handwriting PNG encoded in base64 must fit in a JSON body.
    expect(Math.ceil(LIMITS.handwritingImageMaxBytes / 3) * 4 + 1024).toBeLessThan(LIMITS.jsonBodyMaxBytes);
  });

  it('defaults validate against their schemas', () => {
    expect(ParentSettingsSchema.parse(DEFAULT_PARENT_SETTINGS)).toEqual(DEFAULT_PARENT_SETTINGS);
    expect(DEFAULT_PARENT_SETTINGS).toMatchObject({
      ai: { monthlyBudgetEur: 10, deepQuestions: false, handwritingRecognition: false, allowComplexModel: true },
      privacy: { uploadPageImages: true, uploadOriginals: false },
      safety: { level: 'standard' },
      reader: { freeSelection: false },
    });
    expect(ReadingPreferencesSchema.parse(DEFAULT_READING_PREFERENCES)).toEqual(DEFAULT_READING_PREFERENCES);
    const child: ChildProfile = {
      id: newId(), parentId: newId(), firstName: 'Léo', age: 10, avatar: '🦊', readingLevel: 'intermediaire',
      explanationDifficulty: 'simple', reading: DEFAULT_READING_PREFERENCES, tts: DEFAULT_TTS_PREFERENCES,
      exercises: DEFAULT_EXERCISE_PREFERENCES, createdAt: 1, updatedAt: 1, deletedAt: null,
    };
    expect(ChildProfileSchema.parse(child)).toEqual(child);
    // Old clients may still send voiceURI: it is stripped.
    expect(TTSPreferencesSchema.parse({ rate: 1, pitch: 1, voiceURI: 'x' })).toEqual({ rate: 1, pitch: 1, sentencePauseMs: 250, paragraphPauseMs: 700 });
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
    const chunkPollSchema = AIJobPollSchema(ChunkSummaryDataSchema);
    expectTypeOf<Same<Out<typeof ChildProfileSchema>, ChildProfile>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof TTSPreferencesSchema>, TTSPreferences>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof DocumentMetaSchema>, DocumentMeta>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof DocumentTextModeRequestSchema>, DocumentTextModeRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof DocumentTextModeResponseSchema>, DocumentTextModeResponse>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof PageContentSchema>, PageContent>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ReadingProgressSchema>, ReadingProgress>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ReadingSessionSchema>, ReadingSession>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof InkSpaceSchema>, InkSpace>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof AnnotationSchema>, Annotation>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof QuestionSchema>, Question>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ExerciseSchema>, Exercise>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof AnswerSchema>, Answer>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ParentSettingsSchema>, ParentSettings>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof GlossaryEntrySchema>, GlossaryEntry>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof DictionaryResultSchema>, DictionaryResult>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof AIOperationSchema>, AIOperation>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ExplainWordRequestSchema>, ExplainWordRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ExplainTextRequestSchema>, ExplainTextRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof SimplifyTextRequestSchema>, SimplifyTextRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof TextChunkSchema>, TextChunk>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof SummarizeStageSchema>, SummarizeStage>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof SummarizeRequestSchema>, SummarizeRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof GenerateQuestionsRequestSchema>, GenerateQuestionsRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof CorrectAnswerRequestSchema>, CorrectAnswerRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof QuestionOnTextRequestSchema>, QuestionOnTextRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof RecognizeHandwritingRequestSchema>, RecognizeHandwritingRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ChunkSummaryDataSchema>, ChunkSummaryData>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof HandwritingDataSchema>, HandwritingData>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof AILearnerSchema>, AILearner>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof explainResultSchema>, AIResult<ExplanationData>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof AIJobAcceptedSchema>, AIJobAccepted>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof chunkPollSchema>, AIJobPoll<ChunkSummaryData>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof AIDataSchemaByOperation.summarize>, ChunkSummaryData | SummaryData>>().toEqualTypeOf<true>();
    expectTypeOf<Same<{ [K in AIOperation]: Out<(typeof AIRequestSchemaByOperation)[K]> }, AIRequestByOperation>>().toEqualTypeOf<true>();
    expectTypeOf<Same<{ [K in AIOperation]: Out<(typeof AIDataSchemaByOperation)[K]> }, AIDataByOperation>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof AuthStatusSchema>, AuthStatus>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ParentUserSchema>, ParentUser>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof InvitationConfigSchema>, InvitationConfig>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ClientDiagnosticReportSchema>, ClientDiagnosticReport>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ClientDiagnosticsRequestSchema>, ClientDiagnosticsRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof SyncTableSchema>, SyncTable>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof SyncRejectionSchema>, SyncRejection>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof SyncRequestSchema>, SyncRequest>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof SyncResponseSchema>, SyncResponse>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof OcrServerResultSchema>, OcrServerResult>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof ActivitySummarySchema>, ActivitySummary>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Out<typeof HealthStatusSchema>, HealthStatus>>().toEqualTypeOf<true>();
  });

  it('validates the v1.1 request/response shapes at runtime', () => {
    const base = { childId: newId(), documentId: newId(), documentHash: HASH_A };
    const chunk: TextChunk = { chunkIndex: 0, pageIndexes: [0, 1], text: 'La photosynthèse.', contentHash: HASH_B };
    expect(SummarizeRequestSchema.safeParse({ ...base, level: 'bref', ocrLowConfidence: false, stage: { kind: 'chunk', planHash: HASH_A, chunk } }).success).toBe(true);
    expect(SummarizeRequestSchema.safeParse({ ...base, level: 'bref', ocrLowConfidence: false, stage: { kind: 'final', planHash: HASH_A, chunkCount: 3 } }).success).toBe(true);
    expect(SummarizeRequestSchema.safeParse({ ...base, level: 'bref', ocrLowConfidence: false, stage: { kind: 'final', planHash: HASH_A, chunkCount: 0 } }).success).toBe(false);
    expect(SummarizeRequestSchema.safeParse({ ...base, level: 'bref', stage: { kind: 'final', planHash: HASH_A, chunkCount: 1 } }).success).toBe(false);

    expect(RecognizeHandwritingRequestSchema.safeParse({ ...base, imagePngBase64: 'iVBORw0KGgo=' }).success).toBe(true);
    expect(RecognizeHandwritingRequestSchema.safeParse({ ...base, imagePngBase64: 'data:image/png;base64,iVBORw0KGgo=' }).success).toBe(false);

    const inkText = { kind: 'text', pageIndex: 0, blockIndex: 1, charOffset: 4, blockTextHash: HASH_A, contextText: 'mot' };
    expect(InkSpaceSchema.safeParse({ ...inkText, endAnchor: null }).success).toBe(true);
    expect(InkSpaceSchema.safeParse({ ...inkText, endAnchor: { blockIndex: 2, charOffset: 0 } }).success).toBe(true);
    expect(InkSpaceSchema.safeParse(inkText).success).toBe(false);

    const meta = { cached: false, route: 'complex', promptVersion: PROMPT_VERSION, sourceWarning: false, requestId: 'r1' } as const;
    const poll = AIJobPollSchema(ChunkSummaryDataSchema);
    expect(poll.parse({ status: 'pending', pollAfterMs: TIMINGS.aiJobPollMs })).toEqual({ status: 'pending', pollAfterMs: 3000 });
    expect(poll.safeParse({ status: 'unavailable', reason: 'missing_chunks', message: KID_MESSAGES.unavailable, meta, missingChunkIndexes: [1, 3] }).success).toBe(true);
    expect(poll.safeParse({ status: 'unavailable', reason: 'budget', message: KID_MESSAGES.budget, meta: null }).success).toBe(true);
    expect(poll.safeParse({ status: 'ok', data: { chunkIndex: 0, summary: 'Résumé.', keyQuotes: [] }, meta }).success).toBe(false);
    expect(AIJobAcceptedSchema.safeParse({ status: 'pending', jobId: newId(), pollAfterMs: 3000 }).success).toBe(true);

    expect(SyncRequestSchema.safeParse({ cursor: null, deviceId: 'ipad', changes: emptyChanges() }).success).toBe(true);
    expect(SyncRequestSchema.safeParse({ since: 0, deviceId: 'ipad', changes: emptyChanges() }).success).toBe(false);
    expect(SyncResponseSchema.safeParse({
      cursor: '42', hasMore: false, serverTime: 1, changes: emptyChanges(),
      rejected: [{ table: 'children', entityKey: 'c1', reason: 'parent_locked' }],
    }).success).toBe(true);

    expect(SetupRequestSchema.shape.pin.safeParse('1234').success).toBe(true);
    expect(SetupRequestSchema.shape.pin.safeParse('123456').success).toBe(true);
    expect(SetupRequestSchema.shape.pin.safeParse('123').success).toBe(false);

    expect(InviteCodeSchema.parse('  k7qm-3fxa-9trd ')).toBe('K7QM-3FXA-9TRD');
    expect(InviteCodeSchema.safeParse('court').success).toBe(false);
    expect(InviteCodeSchema.safeParse('code avec espace').success).toBe(false);
    expect(InviteCodeSchema.safeParse('A'.repeat(65)).success).toBe(false);
    const register = { inviteCode: ' abc ', email: ' Parent@Example.org ', password: 'motdepasse!', displayName: ' Sam ', pin: '123456' };
    expect(RegisterRequestSchema.parse(register)).toEqual({
      inviteCode: 'abc', email: 'parent@example.org', password: 'motdepasse!', displayName: 'Sam', pin: '123456',
    });
    expect(RegisterRequestSchema.safeParse({ ...register, inviteCode: '  ' }).success).toBe(false);
    expect(UpdateInvitationRequestSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(UpdateInvitationRequestSchema.safeParse({ enabled: true, regenerate: true, code: 'ABCDEFGH' }).success).toBe(false);
  });

  it('syncEntityKey follows §15.2', () => {
    const page: PageContent = {
      documentId: 'd1', pageIndex: 7, status: 'ready', textSource: 'manual', blocks: [], confidence: null, contentHash: null,
      width: null, height: null, warnings: [], updatedAt: 1,
    };
    expect(syncEntityKey('pages', page)).toBe('d1:7');
    expect(syncEntityKey('progress', { childId: 'c1', documentId: 'd1', pageIndex: 0, blockIndex: 0, sentenceIndex: 0, updatedAt: 1 })).toBe('c1:d1');
    expect(syncEntityKey('documents', {
      id: 'doc', ownerParentId: 'p', childIds: [], title: 't', kind: 'pdf', textMode: 'faithful', purpose: 'reading', homeworkDoneAt: null, sourceHash: HASH_A, pageCount: 1, status: 'ready',
      createdAt: 1, updatedAt: 1, deletedAt: null,
    })).toBe('doc');
    expect(syncEntityKey('sessions', {
      id: 's1', childId: 'c1', documentId: 'd1', startedAt: 1, endedAt: 2, pagesViewed: [], ttsSeconds: 0, wordsLookedUp: 0, aiRequests: 0, updatedAt: 2,
    })).toBe('s1');
  });

  it('planHash is the sha256 of the ordered chunk hashes', async () => {
    const chunks: TextChunk[] = [
      { chunkIndex: 0, pageIndexes: [0], text: 'a', contentHash: HASH_A },
      { chunkIndex: 1, pageIndexes: [1], text: 'b', contentHash: HASH_B },
    ];
    expect(await planHash(chunks)).toBe(await sha256Hex(HASH_A + HASH_B));
    expect(await planHash([...chunks].reverse())).not.toBe(await planHash(chunks));
  });

  describe('routeFor (§8.2 step 5 + §15.4)', () => {
    const defaults = settingsWith({});

    it('routes each operation to its tier', () => {
      expect(routeFor('explain_word', 50_000, defaults)).toBe('light');
      expect(routeFor('correct_answer', 50_000, defaults)).toBe('light');
      expect(routeFor('recognize_handwriting', 0, defaults)).toBe('local');   // off by default (C3)
      expect(routeFor('recognize_handwriting', 0, settingsWith({ handwritingRecognition: true }))).toBe('light');
      expect(routeFor('generate_questions', 10, defaults)).toBe('complex');
      expect(routeFor('explain_text', LIMITS.explainTextMaxChars, defaults)).toBe('light');
      expect(routeFor('explain_text', LIMITS.explainTextMaxChars + 1, defaults)).toBe('complex');
      expect(routeFor('simplify_text', LIMITS.explainTextMaxChars, defaults)).toBe('light');
      expect(routeFor('simplify_text', LIMITS.explainTextMaxChars + 1, defaults)).toBe('complex');
    });

    it('routes summaries by stage (chunk light, final complex)', () => {
      expect(routeFor('summarize', 6000, defaults, { summarizeStage: 'chunk' })).toBe('light');
      expect(routeFor('summarize', 0, defaults, { summarizeStage: 'final' })).toBe('complex');
      expect(routeFor('summarize', 0, defaults)).toBe('complex');
    });

    it('keeps question_on_text light unless deep questions are enabled for a long input', () => {
      expect(routeFor('question_on_text', LIMITS.retrieveMaxChars, defaults)).toBe('light');
      const deep = settingsWith({ deepQuestions: true });
      expect(routeFor('question_on_text', LIMITS.questionOnTextLightMaxChars, deep)).toBe('light');
      expect(routeFor('question_on_text', LIMITS.questionOnTextLightMaxChars + 1, deep)).toBe('complex');
    });

    it('falls back to local when AI, the feature or the complex model is off', () => {
      const noComplex = settingsWith({ allowComplexModel: false });
      expect(routeFor('generate_questions', 10, noComplex)).toBe('local');
      expect(routeFor('summarize', 0, noComplex, { summarizeStage: 'final' })).toBe('local');
      expect(routeFor('summarize', 0, noComplex, { summarizeStage: 'chunk' })).toBe('light');
      expect(routeFor('explain_word', 5, settingsWith({ enabled: false }))).toBe('local');
      const noQuestions = settingsWith({ features: { ...DEFAULT_PARENT_SETTINGS.ai.features, questions: false } });
      expect(routeFor('generate_questions', 10, noQuestions)).toBe('local');
      expect(routeFor('explain_word', 10, noQuestions)).toBe('light');
    });

    it('maps every operation to its parent flag', () => {
      expect(isAIOperationEnabled('recognize_handwriting', defaults)).toBe(false);
      expect(isAIOperationEnabled('recognize_handwriting', settingsWith({ handwritingRecognition: true }))).toBe(true);
      const flags: Record<AIOperation, keyof ParentSettings['ai']['features'] | null> = {
        explain_word: 'explainWord', explain_text: 'explainText', simplify_text: 'simplify', summarize: 'summarize',
        generate_questions: 'questions', correct_answer: 'correctAnswers', question_on_text: 'questionOnText', recognize_handwriting: null,
        free_question: 'freeQuestion', correct_writing: 'correctWriting',
      };
      for (const op of AIOperationSchema.options) {
        const flag = flags[op];
        if (flag === null) continue;
        expect(isAIOperationEnabled(op, defaults), op).toBe(true);
        expect(isAIOperationEnabled(op, settingsWith({ features: { ...DEFAULT_PARENT_SETTINGS.ai.features, [flag]: false } })), op).toBe(false);
      }
    });
  });
});

function emptyChanges(): SyncRequest['changes'] {
  return { documents: [], pages: [], annotations: [], progress: [], sessions: [], exercises: [], answers: [], children: [] };
}

describe('document text mode (§17.10)', () => {
  const doc = {
    id: newId(), ownerParentId: newId(), childIds: [], title: 'Ma rédaction', kind: 'images', sourceHash: HASH_A, pageCount: 1,
    status: 'processing', createdAt: 1, updatedAt: 1, deletedAt: null,
  };

  it('documents without a text mode (older copies and clients) are faithful; only the two modes exist', () => {
    expect(DocumentMetaSchema.parse(doc).textMode).toBe('faithful');
    expect(DocumentMetaSchema.parse({ ...doc, textMode: 'punctuated' }).textMode).toBe('punctuated');
    expect(DocumentMetaSchema.safeParse({ ...doc, textMode: 'corrected' }).success).toBe(false);
  });

  it('the change request only carries the mode', () => {
    expect(DocumentTextModeRequestSchema.safeParse({ textMode: 'punctuated' }).success).toBe(true);
    expect(DocumentTextModeRequestSchema.safeParse({ textMode: 'punctuated', documentId: newId() }).success).toBe(false);
    expect(DocumentTextModeResponseSchema.safeParse({ document: { ...doc, textMode: 'punctuated' }, queued: 2 }).success).toBe(true);
    expect(DocumentTextModeResponseSchema.safeParse({ document: doc, queued: -1 }).success).toBe(false);
  });
});
