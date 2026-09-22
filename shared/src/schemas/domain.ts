import { z } from 'zod';
import { PREFERENCE_RANGES as R, LIMITS } from '../constants';
import { SPOKEN_BLOCK_MAX_CHARS } from '../text/spoken';
import { IdSchema, MillisSchema, PageIndexSchema, QuestionTypeSchema, Sha256HexSchema } from './common';

export const ParentUserSchema = z.object({
  id: IdSchema,
  email: z.string().max(254),
  displayName: z.string().max(80),
  createdAt: MillisSchema,
  isOwner: z.boolean(),
});

export const ReadingLevelSchema = z.enum(['debutant', 'intermediaire', 'avance']);
export const ExplanationDifficultySchema = z.enum(['tres_simple', 'simple', 'normal']);
export const ReadingFontSchema = z.enum(['lexend', 'andika', 'atkinson', 'opendyslexic', 'systeme']);
export const ReadingThemeSchema = z.enum(['creme', 'clair', 'sombre']);
export const ReadingPaletteSchema = z.enum(['standard', 'separees', 'contraste']);
export const LayoutModeSchema = z.enum(['page', 'continu']);

export const ReadingAidsSchema = z.object({
  syllables: z.boolean(),
  silentLetters: z.boolean(),
  sounds: z.boolean(),
  changedLetters: z.boolean(),
  liaisons: z.boolean(),
});

export const ReadingPreferencesSchema = z.object({
  font: ReadingFontSchema,
  fontSizePx: z.number().min(R.fontSizePx.min).max(R.fontSizePx.max),
  lineHeight: z.number().min(R.lineHeight.min).max(R.lineHeight.max),
  letterSpacingEm: z.number().min(R.letterSpacingEm.min).max(R.letterSpacingEm.max),
  wordSpacingEm: z.number().min(R.wordSpacingEm.min).max(R.wordSpacingEm.max),
  columnWidthEm: z.number().min(R.columnWidthEm.min).max(R.columnWidthEm.max),
  theme: ReadingThemeSchema,
  // §31: profiles saved before the palettes existed use the colours the app has always had.
  palette: ReadingPaletteSchema.default('standard'),
  layoutMode: LayoutModeSchema,
  sentenceHighlight: z.boolean(),
  readingGuide: z.boolean(),
  // §26: profiles saved before the reading aids existed have none.
  aids: ReadingAidsSchema.default({ syllables: false, silentLetters: false, sounds: false, changedLetters: false, liaisons: false }),
});

const SentencePauseSchema = z.number().int().min(R.ttsSentencePauseMs.min).max(R.ttsSentencePauseMs.max);
const ParagraphPauseSchema = z.number().int().min(R.ttsParagraphPauseMs.min).max(R.ttsParagraphPauseMs.max);

export const TTSPreferencesSchema = z.object({
  rate: z.number().min(R.ttsRate.min).max(R.ttsRate.max),
  pitch: z.number().min(R.ttsPitch.min).max(R.ttsPitch.max),
  // Defaults: profiles saved before the pause settings existed stay valid.
  sentencePauseMs: SentencePauseSchema.default(250),
  paragraphPauseMs: ParagraphPauseSchema.default(700),
});

/**
 * Partial preferences (PATCH /api/children/:id/preferences): without the defaults of the full profile, which `.partial()`
 * would apply to every missing field (a new font size must not switch the couleurs de lecture off).
 */
export const ReadingPreferencesPatchSchema = ReadingPreferencesSchema.extend({ aids: ReadingAidsSchema }).partial();
export const TTSPreferencesPatchSchema = TTSPreferencesSchema.extend({ sentencePauseMs: SentencePauseSchema, paragraphPauseMs: ParagraphPauseSchema }).partial();

export const QuestionCountSchema = z.union([z.literal(3), z.literal(5), z.literal(10)]);

export const ExercisePreferencesSchema = z.object({
  defaultQuestionCount: QuestionCountSchema,
  enabledTypes: z.array(QuestionTypeSchema).max(5),
});

export const ChildProfileSchema = z.object({
  id: IdSchema,
  parentId: IdSchema,
  nickname: z.string().trim().min(R.nicknameLength.min).max(R.nicknameLength.max),
  avatar: z.string().min(1).max(32),
  readingLevel: ReadingLevelSchema,
  explanationDifficulty: ExplanationDifficultySchema,
  reading: ReadingPreferencesSchema,
  tts: TTSPreferencesSchema,
  exercises: ExercisePreferencesSchema,
  createdAt: MillisSchema,
  updatedAt: MillisSchema,
  deletedAt: MillisSchema.nullable(),
});

export const DocumentKindSchema = z.enum(['pdf', 'images', 'epub']);
export const DocumentTextModeSchema = z.enum(['faithful', 'punctuated']);
export const DocumentPurposeSchema = z.enum(['reading', 'homework']);
export const DocumentStatusSchema = z.enum(['processing', 'ready', 'partial']);
export const PageStatusSchema = z.enum(['pending', 'processing', 'ready', 'low_confidence', 'failed']);
export const PageTextSourceSchema = z.enum(['pdf-text', 'ocr-local', 'ocr-server', 'manual', 'epub-text', 'ocr-ai']);
export const PageWarningSchema = z.enum(['low_confidence', 'server_fallback_used', 'manually_corrected', 'suspicious_instructions', 'no_text_found', 'awaiting_ai']);

export const DocumentMetaSchema = z.object({
  id: IdSchema,
  ownerParentId: IdSchema,
  childIds: z.array(IdSchema).max(20),
  title: z.string().max(LIMITS.titleMaxChars),
  kind: DocumentKindSchema,
  // Absent in documents created before §17.10 (local copies, older clients).
  textMode: DocumentTextModeSchema.default('faithful'),
  // Absent in documents created before §19.3.
  purpose: DocumentPurposeSchema.default('reading'),
  homeworkDoneAt: MillisSchema.nullable().default(null),
  sourceHash: Sha256HexSchema,
  pageCount: z.number().int().nonnegative().max(10000),
  status: DocumentStatusSchema,
  createdAt: MillisSchema,
  updatedAt: MillisSchema,
  deletedAt: MillisSchema.nullable(),
});

export const TextBlockSchema = z.object({
  kind: z.enum(['title', 'paragraph']),
  text: z.string().max(LIMITS.pagesMaxTotalChars),
  spoken: z.string().max(SPOKEN_BLOCK_MAX_CHARS).optional(),
});

export const PageContentSchema = z.object({
  documentId: IdSchema,
  pageIndex: PageIndexSchema,
  status: PageStatusSchema,
  textSource: PageTextSourceSchema.nullable(),
  blocks: z.array(TextBlockSchema).max(2000),
  confidence: z.number().min(0).max(100).nullable(),
  contentHash: Sha256HexSchema.nullable(),
  width: z.number().int().nonnegative().nullable(),
  height: z.number().int().nonnegative().nullable(),
  warnings: z.array(PageWarningSchema).max(10),
  updatedAt: MillisSchema,
});

export const ReadingProgressSchema = z.object({
  childId: IdSchema,
  documentId: IdSchema,
  pageIndex: PageIndexSchema,
  blockIndex: z.number().int().nonnegative(),
  sentenceIndex: z.number().int().nonnegative(),
  updatedAt: MillisSchema,
});

export const ReadingSessionSchema = z.object({
  id: IdSchema,
  childId: IdSchema,
  documentId: IdSchema,
  startedAt: MillisSchema,
  endedAt: MillisSchema,
  pagesViewed: z.array(PageIndexSchema).max(10000),
  ttsSeconds: z.number().nonnegative(),
  wordsLookedUp: z.number().int().nonnegative(),
  aiRequests: z.number().int().nonnegative(),
  updatedAt: MillisSchema,
});
