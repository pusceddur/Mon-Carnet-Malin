import type { ExplanationDifficulty, ExercisePreferences, ReadingAids, ReadingPreferences, TTSPreferences } from './types/domain';
import type { InkTool, Thickness } from './types/annotations';
import type { QuestionType } from './types/exercises';
import type { ParentSettings } from './types/settings';
import type { SummaryLevel } from './types/ai';

export const APP_NAME = 'Mon Carnet Malin';
export const APP_SHORT_NAME = 'Carnet Malin';

export const PROMPT_VERSION = '2026-09-16.1';

export const QUESTION_TYPES: readonly QuestionType[] = ['qcm', 'vrai_faux', 'reponse_libre', 'association', 'ordre'];

export const DEFAULT_READING_AIDS: ReadingAids = { syllables: false, silentLetters: false, sounds: false, changedLetters: false, liaisons: false };

export const DEFAULT_READING_PREFERENCES: ReadingPreferences = {
  font: 'lexend',
  fontSizePx: 24,
  lineHeight: 1.8,
  letterSpacingEm: 0.04,
  wordSpacingEm: 0.16,
  columnWidthEm: 30,
  theme: 'creme',
  layoutMode: 'page',
  sentenceHighlight: true,
  readingGuide: false,
  aids: DEFAULT_READING_AIDS,
};

export const DEFAULT_TTS_PREFERENCES: TTSPreferences = {
  rate: 0.85,
  pitch: 1,
  sentencePauseMs: 250,
  paragraphPauseMs: 700,
};

export const DEFAULT_EXERCISE_PREFERENCES: ExercisePreferences = {
  defaultQuestionCount: 5,
  enabledTypes: [...QUESTION_TYPES],
};

export const DEFAULT_PARENT_SETTINGS: ParentSettings = {
  ai: {
    enabled: true,
    features: {
      explainWord: true,
      explainText: true,
      simplify: true,
      summarize: true,
      questions: true,
      correctAnswers: true,
      questionOnText: true,
      freeQuestion: true,
      correctWriting: true,
    },
    dailyRequestLimitPerChild: 60,
    monthlyBudgetEur: 10,
    allowComplexModel: true,
    deepQuestions: false,
    handwritingRecognition: false,
  },
  ocr: { autoServerFallback: true, lowConfidenceThreshold: 70, aiTranscription: true },
  privacy: { syncAnnotations: true, syncDocumentText: true, uploadPageImages: true, uploadOriginals: false },
  safety: { level: 'standard' },
  reader: { freeSelection: false },
  updatedAt: 0,
};

/** Value ranges of the profile preferences (§5). */
export const PREFERENCE_RANGES = {
  fontSizePx: { min: 16, max: 44 },
  lineHeight: { min: 1.2, max: 2.6 },
  letterSpacingEm: { min: 0, max: 0.3 },
  wordSpacingEm: { min: 0, max: 0.8 },
  columnWidthEm: { min: 18, max: 48 },
  ttsRate: { min: 0.5, max: 1.5 },
  ttsPitch: { min: 0.8, max: 1.2 },
  ttsSentencePauseMs: { min: 0, max: 1500 },
  ttsParagraphPauseMs: { min: 0, max: 3000 },
  childAge: { min: 5, max: 15 },
  firstNameLength: { min: 1, max: 40 },
} as const;

/** §8.6 limits + §8.4/§15.5 length limits (words) + request/transport limits (§15.2, §15.6, §15.8). */
export const LIMITS = {
  // §8.6 characters
  chunkMaxChars: 6000,
  chunkTextMaxChars: 12000,             // hard cap of one TextChunk.text (an oversize paragraph must be split)
  explainTextMaxChars: 1200,
  selectionMaxChars: 4000,
  questionOnTextMaxChars: 200,
  freeQuestionMaxChars: 300,            // §18 « Pose ta question »
  writingMaxLines: 100,                 // §24 « Corriger »: lines of a text box sent for correction
  answerMaxChars: 1000,
  pagesMaxTotalChars: 200000,
  // tier selection (§8.2 step 5, §15.4)
  questionOnTextLightMaxChars: 6000,
  retrieveMaxChars: 12000,              // retrieveRelevantParagraphs default budget (§15.4)
  // progressive summary (§15.4)
  summarizeChunkParallelism: 2,         // client: at most 2 chunk requests in flight
  summarizeMaxChunks: 1000,
  chunkKeyQuotesMin: 1,
  chunkKeyQuotesMax: 3,
  summaryMaxExcludedChunkRatio: 0.3,    // more excluded (blocked) chunks -> blocked/validation
  // request fields
  wordMaxChars: 100,
  paragraphMaxChars: 8000,
  titleMaxChars: 200,
  // §8.4 LengthGuard (words unless stated)
  explainWordMaxWords: 60,
  explainWordTresSimpleMaxWords: 45,
  explainTextMaxWords: 90,
  exampleMaxWords: 25,
  // §15.5 simplify: words in [0.3 x source, max(1.5 x source, source + 12)]
  simplifyMinRatio: 0.3,
  simplifyMaxRatio: 1.5,
  simplifyMaxExtraWords: 12,
  summaryMaxWords: { bref: 80, normal: 160, detaille: 300 } satisfies Record<SummaryLevel, number>,
  keyPointsMax: 7,
  keyPointMaxWords: 20,
  questionPromptMaxWords: 30,
  correctionFeedbackMaxWords: 50,
  questionOnTextAnswerMaxWords: 60,
  kidDefinitionMaxWords: 30,
  // C14: keep generated questions if >= 60% of requested survive validation
  questionsMinKeptRatio: 0.6,
  // SourceGuard OCR tolerance (Jaccard on tokens)
  sourceQuoteJaccardMin: 0.85,
  // LocalProvider extractive summary sentence counts (§8.3)
  localSummarySentences: { bref: 3, normal: 6, detaille: 10 } satisfies Record<SummaryLevel, number>,
  // transport (§15.2, §15.6)
  syncBodyMaxBytes: 25 * 1024 * 1024,   // /api/sync
  jsonBodyMaxBytes: 2 * 1024 * 1024,    // /api/ai/* and every other JSON route
  syncPullMaxRows: 500,
  ocrImageMaxBytes: 15 * 1024 * 1024,
  // PNG sent as base64 inside a JSON body limited to jsonBodyMaxBytes
  handwritingImageMaxBytes: 1024 * 1024,
  documentFileMaxBytes: 30 * 1024 * 1024,
  pageImageMaxBytes: 5 * 1024 * 1024,
  documentFileIndexMax: 999,
  ocrImageMaxSidePx: 2480,
  // auth (§15.8)
  pinMinDigits: 4,                      // allowed with a UI warning
  pinDefaultDigits: 6,
  pinMaxDigits: 8,
  passwordMinChars: 10,
  inviteCodeMinChars: 8,
  inviteCodeMaxChars: 64,
} as const;

/** §15.8 default PIN length suggested by the UI. */
export const PIN_DEFAULT_DIGITS = LIMITS.pinDefaultDigits;

/** §8.4 AgeGuard thresholds per explanation difficulty. */
export const AGE_THRESHOLDS: Readonly<Record<ExplanationDifficulty, { avgWordsPerSentence: number; maxWordsPerSentence: number; longWordRatio: number }>> = {
  tres_simple: { avgWordsPerSentence: 14, maxWordsPerSentence: 22, longWordRatio: 0.15 },
  simple: { avgWordsPerSentence: 17, maxWordsPerSentence: 26, longWordRatio: 0.2 },
  normal: { avgWordsPerSentence: 20, maxWordsPerSentence: 32, longWordRatio: 0.25 },
};

/** Timeouts and durations (ms). AI deadlines live in AI_DEADLINES (ai/routing.ts). */
export const TIMINGS = {
  aiClientTimeoutMarginMs: 15_000,       // client timeout = AI_DEADLINES[route] + margin (§15.4)
  aiJobPollMs: 3_000,                    // default pollAfterMs of async AI jobs
  aiJobStaleMarginMs: 30_000,            // pending job older than deadline + margin -> unavailable/timeout
  aiJobTtlMs: 60 * 60_000,               // ai_jobs retention (§15.3)
  parentUnlockMs: 15 * 60_000,           // C8
  sessionTtlMs: 180 * 24 * 60 * 60_000,  // §7
  syncIntervalMs: 60_000,                // §10
  syncDebounceMs: 5_000,
  syncMaxClockSkewMs: 5 * 60_000,        // updatedAt beyond serverTime + skew is clamped to serverTime (§15.2)
  penActiveGraceMs: 500,                 // §15.7 pencil input policy
  ttsWatchdogMs: 3_000,                  // §15.7 onstart watchdog
} as const;

/** §8.5 + §15.4/§15.5 messages shown to the child (French). */
export const KID_MESSAGES = {
  notInText: 'Je ne trouve pas cette information dans le texte.',
  blocked: "Je ne peux pas t'aider pour ce passage. Tu peux demander à un adulte.",
  adultRedirect: 'Ce passage parle de choses difficiles. Parles-en avec un adulte de confiance. 💛',
  offline: 'Pas de connexion pour le moment. Tu peux continuer à lire et à écouter.',
  unavailable: "L'aide n'est pas disponible pour le moment. Tu peux continuer à lire.",
  quota: "Tu as beaucoup travaillé aujourd'hui ! L'aide revient demain.",
  budget: "Tu as beaucoup travaillé ce mois-ci ! L'aide revient bientôt.",
  strict: "Demande à un adulte de t'aider pour ce passage.",
  sourceWarning: '⚠️ Une partie du texte a peut-être été mal lue.',
  // §18 free questions (not about a book passage).
  questionBlocked: "Je ne peux pas répondre à cette question. Tu peux en parler avec un adulte de confiance.",
  questionAdultRedirect: 'Cette question est importante. Parles-en avec un adulte de confiance, il saura t’aider. 💛',
  questionStrict: "Pour cette question, demande plutôt à un adulte.",
} as const;

/** §11.5 ink palette. */
export const INK_COLORS = {
  noir: '#1f2937',
  bleu: '#2563eb',
  rouge: '#dc2626',
  vert: '#16a34a',
  violet: '#9333ea',
} as const;

/** §11.5 highlighter palette. */
export const HIGHLIGHTER_COLORS = {
  jaune: '#fde047',
  vert: '#86efac',
  bleu: '#93c5fd',
  rose: '#f9a8d4',
} as const;

/** §11.5 stroke widths in em (text view). */
export const THICKNESS_EM: Readonly<Record<InkTool, Readonly<Record<Thickness, number>>>> = {
  pencil: { fin: 0.08, moyen: 0.14, epais: 0.22 },
  pen: { fin: 0.06, moyen: 0.1, epais: 0.16 },
  highlighter: { fin: 0.7, moyen: 1.0, epais: 1.3 },
};
