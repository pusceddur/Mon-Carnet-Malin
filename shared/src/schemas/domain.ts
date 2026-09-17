import { z } from 'zod';
import { PREFERENCE_RANGES as R, LIMITS } from '../constants';
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
export const LayoutModeSchema = z.enum(['page', 'continu']);

export const ReadingPreferencesSchema = z.object({
  font: ReadingFontSchema,
  fontSizePx: z.number().min(R.fontSizePx.min).max(R.fontSizePx.max),
  lineHeight: z.number().min(R.lineHeight.min).max(R.lineHeight.max),
  letterSpacingEm: z.number().min(R.letterSpacingEm.min).max(R.letterSpacingEm.max),
  wordSpacingEm: z.number().min(R.wordSpacingEm.min).max(R.wordSpacingEm.max),
  columnWidthEm: z.number().min(R.columnWidthEm.min).max(R.columnWidthEm.max),
  theme: ReadingThemeSchema,
  layoutMode: LayoutModeSchema,
  sentenceHighlight: z.boolean(),
  readingGuide: z.boolean(),
});

export const TTSPreferencesSchema = z.object({
  rate: z.number().min(R.ttsRate.min).max(R.ttsRate.max),
  pitch: z.number().min(R.ttsPitch.min).max(R.ttsPitch.max),
  // Defaults: profiles saved before the pause settings existed stay valid.
  sentencePauseMs: z.number().int().min(R.ttsSentencePauseMs.min).max(R.ttsSentencePauseMs.max).default(250),
  paragraphPauseMs: z.number().int().min(R.ttsParagraphPauseMs.min).max(R.ttsParagraphPauseMs.max).default(700),
});

export const QuestionCountSchema = z.union([z.literal(3), z.literal(5), z.literal(10)]);

export const ExercisePreferencesSchema = z.object({
  defaultQuestionCount: QuestionCountSchema,
  enabledTypes: z.array(QuestionTypeSchema).max(5),
});

export const ChildProfileSchema = z.object({
  id: IdSchema,
  parentId: IdSchema,
  firstName: z.string().trim().min(R.firstNameLength.min).max(R.firstNameLength.max),
  age: z.number().int().min(R.childAge.min).max(R.childAge.max),
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
