import { Dexie, type EntityTable, type Table } from 'dexie';
import type {
  AIOperation, AIResult, Annotation, Answer, ChildProfile, DictionaryResult, DocumentMeta, Exercise, GlossaryEntry, Id, Millis,
  PageContent, ReadingProgress, ReadingSession, SyncChanges,
} from '@aide/shared';

export interface DocumentFileRecord { documentId: Id; index: number; name: string; mime: string; size: number; blob: Blob }
// 'ocr': processed grayscale page (OCR, reprocessing); 'color': same frame in color (§19.1, Original view); 'thumb': 240 px.
export interface PageImageRecord { documentId: Id; pageIndex: number; variant: 'ocr' | 'color' | 'thumb'; blob: Blob; width: number; height: number }
export type JobState = 'queued' | 'running' | 'done' | 'error';
export interface JobRecord { documentId: Id; pageIndex: number; state: JobState; stage: string; attempts: number; error: string | null; updatedAt: Millis }
export interface AiCacheRecord { key: string; operation: AIOperation; result: AIResult<unknown>; createdAt: Millis }
export interface DictionaryCacheRecord { word: string; result: DictionaryResult; fetchedAt: Millis }
export interface OutboxRecord { seq: number; table: keyof SyncChanges; entityId: string; queuedAt: Millis }
/** Keys: authStatus, parentSettings, selectedChildId, deviceId, lastSyncAt (free-form for other modules). */
export interface KvRecord { key: string; value: unknown }

export type AideDb = Dexie & {
  documents: EntityTable<DocumentMeta, 'id'>;
  documentFiles: Table<DocumentFileRecord, [Id, number]>;
  pages: Table<PageContent, [Id, number]>;
  pageImages: Table<PageImageRecord, [Id, number, PageImageRecord['variant']]>;
  jobs: Table<JobRecord, [Id, number]>;
  annotations: EntityTable<Annotation, 'id'>;
  progress: Table<ReadingProgress, [Id, Id]>;
  sessions: EntityTable<ReadingSession, 'id'>;
  exercises: EntityTable<Exercise, 'id'>;
  answers: EntityTable<Answer, 'id'>;
  children: EntityTable<ChildProfile, 'id'>;
  aiCache: EntityTable<AiCacheRecord, 'key'>;
  dictionaryCache: EntityTable<DictionaryCacheRecord, 'word'>;
  glossary: EntityTable<GlossaryEntry, 'headword'>;
  outbox: EntityTable<OutboxRecord, 'seq'>;
  kv: EntityTable<KvRecord, 'key'>;
};

export const DB_NAME = 'aide';

export const db = new Dexie(DB_NAME) as AideDb;

db.version(1).stores({
  documents:      'id, updatedAt',
  documentFiles:  '[documentId+index], documentId',
  pages:          '[documentId+pageIndex], documentId, updatedAt',
  pageImages:     '[documentId+pageIndex+variant], documentId',
  jobs:           '[documentId+pageIndex], documentId, state',
  annotations:    'id, documentId, childId, updatedAt, [documentId+childId]',
  progress:       '[childId+documentId], childId, updatedAt',
  sessions:       'id, childId, updatedAt',
  exercises:      'id, childId, documentId, updatedAt',
  answers:        'id, exerciseId, childId, updatedAt',
  children:       'id, updatedAt',
  aiCache:        'key, createdAt',
  dictionaryCache:'word, fetchedAt',
  glossary:       'headword',
  outbox:         '++seq, table, entityId',
  kv:             'key',
});
