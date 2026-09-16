import type { QuestionType } from './exercises';

export type Id = string;
export type Millis = number;

export interface ParentUser { id: Id; email: string; displayName: string; createdAt: Millis }

export type ReadingLevel = 'debutant' | 'intermediaire' | 'avance';
export type ExplanationDifficulty = 'tres_simple' | 'simple' | 'normal';
export type ReadingFont = 'lexend' | 'andika' | 'atkinson' | 'opendyslexic' | 'systeme';
export type ReadingTheme = 'creme' | 'clair' | 'sombre';
export type LayoutMode = 'page' | 'continu';

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
}
export interface TTSPreferences { rate: number /*0.5..1.5, default 0.85*/; pitch: number /*0.8..1.2, default 1*/; voiceURI: string | null }
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

export type DocumentKind = 'pdf' | 'images';
export type DocumentStatus = 'processing' | 'ready' | 'partial';   // partial = some pages failed/doubtful
export type PageStatus = 'pending' | 'processing' | 'ready' | 'low_confidence' | 'failed';
export type PageTextSource = 'pdf-text' | 'ocr-local' | 'ocr-server' | 'manual';
export type PageWarning = 'low_confidence' | 'server_fallback_used' | 'manually_corrected' | 'suspicious_instructions' | 'no_text_found';

export interface DocumentMeta {
  id: Id; ownerParentId: Id; childIds: Id[];
  title: string; kind: DocumentKind;
  sourceHash: string;           // sha256 hex of original files (hash of concatenated hashes, in order)
  pageCount: number; status: DocumentStatus;
  createdAt: Millis; updatedAt: Millis; deletedAt: Millis | null;
}
export interface TextBlock { kind: 'title' | 'paragraph'; text: string }
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
