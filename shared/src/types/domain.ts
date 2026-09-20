import type { QuestionType } from './exercises';

export type Id = string;
export type Millis = number;

/** `isOwner`: the account that manages invitations (first account of the server). */
export interface ParentUser { id: Id; email: string; displayName: string; createdAt: Millis; isOwner: boolean }

export type ReadingLevel = 'debutant' | 'intermediaire' | 'avance';
export type ExplanationDifficulty = 'tres_simple' | 'simple' | 'normal';
export type ReadingFont = 'lexend' | 'andika' | 'atkinson' | 'opendyslexic' | 'systeme';
export type ReadingTheme = 'creme' | 'clair' | 'sombre';
export type LayoutMode = 'page' | 'continu';

/** §26 « Couleurs de lecture »: marks drawn on the text, each one on or off (codeFrenchText). */
export interface ReadingAids {
  syllables: boolean;       // syllables in two alternating colours
  silentLetters: boolean;   // silent letters in light grey
  sounds: boolean;          // letters making one sound together, on a coloured background
  changedLetters: boolean;  // letters that do not make their usual sound, underlined with dots
  liaisons: boolean;        // arc joining the words of a liaison
}
export interface ReadingPreferences {
  font: ReadingFont;            // default 'lexend'
  fontSizePx: number;           // 16..44, default 24
  lineHeight: number;           // 1.2..2.6, default 1.8
  letterSpacingEm: number;      // 0..0.3, default 0.04
  wordSpacingEm: number;        // 0..0.8, default 0.16
  columnWidthEm: number;        // 18..48, default 30
  theme: ReadingTheme;          // default 'creme'
  layoutMode: LayoutMode;       // default 'page'
  sentenceHighlight: boolean;   // default true
  readingGuide: boolean;        // reading ruler, default false
  aids: ReadingAids;            // §26, default: all off
}
// §15.7: the voice is chosen per device (Dexie kv key `ttsVoiceURI`), not per profile.
export interface TTSPreferences {
  rate: number /*0.5..1.5, default 0.85*/;
  pitch: number /*0.8..1.2, default 1*/;
  /** Silence after each sentence (ms, 0..1500, default 250). */
  sentencePauseMs: number;
  /** Silence when the next sentence starts a new paragraph (ms, 0..3000, default 700). */
  paragraphPauseMs: number;
}
export interface ExercisePreferences { defaultQuestionCount: 3 | 5 | 10; enabledTypes: QuestionType[] /*default: all*/ }

export interface ChildProfile {
  id: Id; parentId: Id;
  firstName: string;            // first name or nickname, 1..40
  age: number;                  // 5..15
  avatar: string;               // emoji
  readingLevel: ReadingLevel;
  explanationDifficulty: ExplanationDifficulty;
  reading: ReadingPreferences; tts: TTSPreferences; exercises: ExercisePreferences;
  createdAt: Millis; updatedAt: Millis; deletedAt: Millis | null;
}

export type DocumentKind = 'pdf' | 'images' | 'epub';
// 'faithful': text as printed (books, default). 'punctuated': text written by a child (§17.10): the « lecture intelligente »
// keeps every word and only restores punctuation and sentence capitals, so that the voice reads it naturally.
export type DocumentTextMode = 'faithful' | 'punctuated';
// 'reading': a book or a document to read (default). 'homework': a sheet the child completes in the app (§19.3).
export type DocumentPurpose = 'reading' | 'homework';
export type DocumentStatus = 'processing' | 'ready' | 'partial';   // partial = some pages failed/doubtful
export type PageStatus = 'pending' | 'processing' | 'ready' | 'low_confidence' | 'failed';
// 'ocr-ai': page transcribed from its image by the external worker (§17).
export type PageTextSource = 'pdf-text' | 'ocr-local' | 'ocr-server' | 'manual' | 'epub-text' | 'ocr-ai';
// 'awaiting_ai': no on-device / server reading, the page image waits for the worker transcription (§17).
export type PageWarning = 'low_confidence' | 'server_fallback_used' | 'manually_corrected' | 'suspicious_instructions' | 'no_text_found' | 'awaiting_ai';

export interface DocumentMeta {
  id: Id; ownerParentId: Id; childIds: Id[];
  title: string; kind: DocumentKind;
  textMode: DocumentTextMode;   // changed only through PUT /api/documents/:id/text-mode (never by a sync push)
  purpose: DocumentPurpose;     // set when the document is created
  homeworkDoneAt: Millis | null; // §19.3 « J'ai terminé » (homework only), set and cleared by the child
  sourceHash: string;          // sha256 hex of original files (hash of concatenated hashes, in order)
  pageCount: number; status: DocumentStatus;
  createdAt: Millis; updatedAt: Millis; deletedAt: Millis | null;
}
/**
 * `spoken` (§22 « Préparer la lecture »): the same words as `text`, punctuated for the voice (pauses after list numbers,
 * end of items…). Read aloud instead of `text` while its words match; never displayed.
 */
export interface TextBlock { kind: 'title' | 'paragraph'; text: string; spoken?: string }
export interface PageContent {
  documentId: Id; pageIndex: number;              // 0-based
  status: PageStatus; textSource: PageTextSource | null;
  blocks: TextBlock[];                            // page text; blockIndex = index in array
  confidence: number | null;                      // quality score 0..100 (null for pdf-text/manual)
  contentHash: string | null;                     // sha256(normalizeForMatch(blocks.map(b=>b.text).join('\n\n')))
  width: number | null; height: number | null;    // processed image px (Original view)
  warnings: PageWarning[];
  updatedAt: Millis;
}
export interface ReadingProgress { childId: Id; documentId: Id; pageIndex: number; blockIndex: number; sentenceIndex: number; updatedAt: Millis }
export interface ReadingSession {
  id: Id; childId: Id; documentId: Id; startedAt: Millis; endedAt: Millis;
  pagesViewed: number[]; ttsSeconds: number; wordsLookedUp: number; aiRequests: number; updatedAt: Millis;
}
