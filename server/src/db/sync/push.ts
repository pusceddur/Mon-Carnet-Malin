// §15.2 push: validation per entity, ownership, LWW with future clamp, children/documents rules, privacy.
import {
  AnnotationSchema, AnswerSchema, type ChildProfile, ChildProfileSchema, type DocumentMeta, DocumentMetaSchema, ExerciseSchema,
  PageContentSchema, type ParentSettings, ReadingProgressSchema, ReadingSessionSchema, type SyncRejection,
  type SyncRejectionReason, type SyncTable, TIMINGS,
} from '@aide/shared';
import type { Knex } from 'knex';
import type { z } from 'zod';
import { findAnnotation, saveAnnotation } from '../repositories/annotations';
import { findAnswer, saveAnswer } from '../repositories/answers';
import { findChildById, saveChild } from '../repositories/children';
import { cascadeDocumentDeletion, findDocumentById, saveDocument } from '../repositories/documents';
import { findExercise, saveExercise } from '../repositories/exercises';
import { findPage, savePage } from '../repositories/pages';
import { findProgress, saveProgress } from '../repositories/progress';
import { findReadingSession, saveReadingSession } from '../repositories/readingSessions';
import { openSeqAllocator, type SeqAllocator } from '../repositories/syncCounters';

/** §15.2 push order. */
export const PUSH_ORDER: readonly SyncTable[] = ['children', 'documents', 'pages', 'exercises', 'annotations', 'answers', 'progress', 'sessions'];

export type RawChanges = Record<SyncTable, readonly unknown[]>;

export interface PushContext {
  parentId: string;
  /** Session unlocked with the parent PIN (§15.2 document rules). */
  unlocked: boolean;
  serverTime: number;
  settings: ParentSettings;
}

const ENTITY_KEY_MAX = 100;

function field(raw: unknown, name: string): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = (raw as Record<string, unknown>)[name];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

/** Best-effort syncEntityKey for entities that may not have passed validation. */
export function rawEntityKey(table: SyncTable, raw: unknown): string {
  let key: string | null;
  if (table === 'pages') {
    const doc = field(raw, 'documentId');
    const page = field(raw, 'pageIndex');
    key = doc !== null && page !== null ? `${doc}:${page}` : null;
  } else if (table === 'progress') {
    const child = field(raw, 'childId');
    const doc = field(raw, 'documentId');
    key = child !== null && doc !== null ? `${child}:${doc}` : null;
  } else {
    key = field(raw, 'id');
  }
  const safe = key === null || key === '' ? '?' : key;
  return safe.slice(0, ENTITY_KEY_MAX);
}

/** updatedAt beyond serverTime + allowed skew is brought back to serverTime. */
export function clampUpdatedAt(updatedAt: number, serverTime: number): number {
  return updatedAt > serverTime + TIMINGS.syncMaxClockSkewMs ? serverTime : updatedAt;
}

type Ownership = 'own' | 'own_deleted' | 'foreign' | 'missing';

/** Identifiers of a rejected entity whose current server version should be sent back so the device can restore it. */
export interface RestoreRef { table: SyncTable; id: string | null; childId: string | null; documentId: string | null; pageIndex: number | null }

export interface PushResult { rejected: SyncRejection[]; restore: RestoreRef[] }

function restoreRef(table: SyncTable, raw: unknown): RestoreRef {
  const pageIndex = typeof raw === 'object' && raw !== null ? (raw as { pageIndex?: unknown }).pageIndex : undefined;
  return {
    table,
    id: field(raw, 'id'),
    childId: field(raw, 'childId'),
    documentId: field(raw, 'documentId'),
    pageIndex: typeof pageIndex === 'number' && Number.isInteger(pageIndex) ? pageIndex : null,
  };
}

class PushSession {
  readonly rejected: SyncRejection[] = [];
  readonly restore: RestoreRef[] = [];
  private readonly children = new Map<string, Ownership>();
  private readonly documents = new Map<string, Ownership>();

  constructor(
    private readonly trx: Knex.Transaction,
    private readonly seq: SeqAllocator,
    private readonly ctx: PushContext,
  ) {}

  private ownership(entity: { parentId: string; deletedAt: number | null } | null): Ownership {
    if (!entity) return 'missing';
    if (entity.parentId !== this.ctx.parentId) return 'foreign';
    return entity.deletedAt === null ? 'own' : 'own_deleted';
  }

  private async child(id: string): Promise<Ownership> {
    const cached = this.children.get(id);
    if (cached) return cached;
    const child = await findChildById(this.trx, id);
    const result = this.ownership(child);
    this.children.set(id, result);
    return result;
  }

  private async document(id: string): Promise<Ownership> {
    const cached = this.documents.get(id);
    if (cached) return cached;
    const doc = await findDocumentById(this.trx, id);
    const result = this.ownership(doc ? { parentId: doc.ownerParentId, deletedAt: doc.deletedAt } : null);
    this.documents.set(id, result);
    return result;
  }

  /** Rejection reason for a reference to a child/document, or null when usable. */
  private static referenceReason(o: Ownership): SyncRejectionReason | null {
    if (o === 'own') return null;
    if (o === 'own_deleted') return 'stale';
    return o === 'foreign' ? 'forbidden' : 'invalid';
  }

  private reject(table: SyncTable, key: string, reason: SyncRejectionReason): void {
    this.rejected.push({ table, entityKey: key.slice(0, ENTITY_KEY_MAX), reason });
  }

  private clamp(updatedAt: number): number {
    return clampUpdatedAt(updatedAt, this.ctx.serverTime);
  }

  async apply(table: SyncTable, raw: unknown): Promise<void> {
    const key = rawEntityKey(table, raw);
    const reason = await this.applyOne(table, raw);
    if (!reason) return;
    this.reject(table, key, reason);
    // Ownership is checked again when loading: foreign or missing entities are never sent back.
    if (reason !== 'invalid') this.restore.push(restoreRef(table, raw));
  }

  private parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> | null {
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  private async applyOne(table: SyncTable, raw: unknown): Promise<SyncRejectionReason | null> {
    switch (table) {
      case 'children': return this.applyChild(raw);
      case 'documents': return this.applyDocument(raw);
      case 'pages': return this.applyPage(raw);
      case 'exercises': return this.applyExercise(raw);
      case 'annotations': return this.applyAnnotation(raw);
      case 'answers': return this.applyAnswer(raw);
      case 'progress': return this.applyProgress(raw);
      case 'sessions': return this.applySession(raw);
    }
  }

  // Children: only reading/tts preferences are accepted; everything else is ignored and reported.
  private async applyChild(raw: unknown): Promise<SyncRejectionReason | null> {
    const incoming = this.parse(ChildProfileSchema, raw);
    if (!incoming) return 'invalid';
    const existing = await findChildById(this.trx, incoming.id);
    if (!existing || existing.parentId !== this.ctx.parentId) return 'forbidden';
    if (existing.deletedAt !== null) return 'stale';
    const updatedAt = this.clamp(incoming.updatedAt);
    if (updatedAt <= existing.updatedAt) return 'stale';

    const prefsChanged = !sameJson(existing.reading, incoming.reading) || !sameJson(existing.tts, incoming.tts);
    if (prefsChanged) {
      const next: ChildProfile = { ...existing, reading: incoming.reading, tts: incoming.tts, updatedAt };
      await saveChild(this.trx, next, this.seq.next());
    }
    return otherChildFieldsDiffer(existing, incoming) ? 'forbidden' : null;
  }

  // Documents: creation and title/status/pageCount edits are free; deletion and childIds changes need the PIN.
  // The text mode is set at creation, then only by PUT /api/documents/:id/text-mode (§17.10): a push never changes it.
  // The purpose is set at creation; « J'ai terminé » of a homework (§19.3) is free, like the title.
  private async applyDocument(raw: unknown): Promise<SyncRejectionReason | null> {
    const incoming = this.parse(DocumentMetaSchema, raw);
    if (!incoming) return 'invalid';
    if (incoming.ownerParentId !== this.ctx.parentId) return 'forbidden';
    const existing = await findDocumentById(this.trx, incoming.id);
    if (existing && existing.ownerParentId !== this.ctx.parentId) return 'forbidden';
    for (const childId of incoming.childIds) {
      const o = await this.child(childId);
      if (o === 'foreign' || o === 'missing') return 'forbidden';
    }
    const updatedAt = this.clamp(incoming.updatedAt);

    if (!existing) {
      if (incoming.deletedAt !== null && !this.ctx.unlocked) return 'parent_locked';
      await saveDocument(this.trx, { ...incoming, updatedAt }, this.seq.next());
      this.documents.set(incoming.id, incoming.deletedAt === null ? 'own' : 'own_deleted');
      return null;
    }
    // A deleted document never comes back through sync.
    if (existing.deletedAt !== null) return 'stale';
    if (updatedAt <= existing.updatedAt) return 'stale';
    const childIdsChanged = !sameSet(existing.childIds, incoming.childIds);
    if ((incoming.deletedAt !== null || childIdsChanged) && !this.ctx.unlocked) return 'parent_locked';

    const next: DocumentMeta = {
      ...existing,
      title: incoming.title,
      status: incoming.status,
      pageCount: incoming.pageCount,
      childIds: incoming.childIds,
      homeworkDoneAt: existing.purpose === 'homework' ? incoming.homeworkDoneAt : null,
      deletedAt: incoming.deletedAt,
      updatedAt,
    };
    await saveDocument(this.trx, next, this.seq.next());
    if (next.deletedAt !== null) {
      await cascadeDocumentDeletion(this.trx, this.ctx.parentId, next.id, updatedAt, this.seq);
      this.documents.set(next.id, 'own_deleted');
    }
    return null;
  }

  private async applyPage(raw: unknown): Promise<SyncRejectionReason | null> {
    const incoming = this.parse(PageContentSchema, raw);
    if (!incoming) return 'invalid';
    const docReason = PushSession.referenceReason(await this.document(incoming.documentId));
    if (docReason) return docReason;
    const existing = await findPage(this.trx, incoming.documentId, incoming.pageIndex);
    if (existing && existing.parentId !== this.ctx.parentId) return 'forbidden';
    const updatedAt = this.clamp(incoming.updatedAt);
    if (existing && updatedAt <= existing.page.updatedAt) return 'stale';
    const blocks = this.ctx.settings.privacy.syncDocumentText ? incoming.blocks : [];
    await savePage(this.trx, this.ctx.parentId, { ...incoming, blocks, updatedAt }, this.seq.next());
    return null;
  }

  private async applyExercise(raw: unknown): Promise<SyncRejectionReason | null> {
    const incoming = this.parse(ExerciseSchema, raw);
    if (!incoming) return 'invalid';
    const refReason = PushSession.referenceReason(await this.child(incoming.childId))
      ?? PushSession.referenceReason(await this.document(incoming.documentId));
    if (refReason) return refReason;
    const existing = await findExercise(this.trx, incoming.id);
    if (existing && existing.parentId !== this.ctx.parentId) return 'forbidden';
    const updatedAt = this.clamp(incoming.updatedAt);
    if (existing && updatedAt <= existing.exercise.updatedAt) return 'stale';
    await saveExercise(this.trx, this.ctx.parentId, { ...incoming, updatedAt }, this.seq.next());
    return null;
  }

  private async applyAnnotation(raw: unknown): Promise<SyncRejectionReason | null> {
    if (!this.ctx.settings.privacy.syncAnnotations) return 'forbidden';
    const incoming = this.parse(AnnotationSchema, raw);
    if (!incoming) return 'invalid';
    const childReason = PushSession.referenceReason(await this.child(incoming.childId));
    if (childReason) return childReason;
    if (incoming.documentId !== null) {
      const docReason = PushSession.referenceReason(await this.document(incoming.documentId));
      if (docReason) return docReason;
    }
    const existing = await findAnnotation(this.trx, incoming.id);
    if (existing && existing.parentId !== this.ctx.parentId) return 'forbidden';
    const updatedAt = this.clamp(incoming.updatedAt);
    if (existing && updatedAt <= existing.annotation.updatedAt) return 'stale';
    await saveAnnotation(this.trx, this.ctx.parentId, { ...incoming, updatedAt }, this.seq.next());
    return null;
  }

  private async applyAnswer(raw: unknown): Promise<SyncRejectionReason | null> {
    const incoming = this.parse(AnswerSchema, raw);
    if (!incoming) return 'invalid';
    const childReason = PushSession.referenceReason(await this.child(incoming.childId));
    if (childReason) return childReason;
    const exercise = await findExercise(this.trx, incoming.exerciseId);
    if (!exercise) return 'invalid';
    if (exercise.parentId !== this.ctx.parentId) return 'forbidden';
    const existing = await findAnswer(this.trx, incoming.id);
    if (existing && existing.parentId !== this.ctx.parentId) return 'forbidden';
    const updatedAt = this.clamp(incoming.updatedAt);
    if (existing && updatedAt <= existing.answer.updatedAt) return 'stale';
    await saveAnswer(this.trx, this.ctx.parentId, { ...incoming, updatedAt }, this.seq.next());
    return null;
  }

  private async applyProgress(raw: unknown): Promise<SyncRejectionReason | null> {
    const incoming = this.parse(ReadingProgressSchema, raw);
    if (!incoming) return 'invalid';
    const refReason = PushSession.referenceReason(await this.child(incoming.childId))
      ?? PushSession.referenceReason(await this.document(incoming.documentId));
    if (refReason) return refReason;
    const existing = await findProgress(this.trx, incoming.childId, incoming.documentId);
    if (existing && existing.parentId !== this.ctx.parentId) return 'forbidden';
    const updatedAt = this.clamp(incoming.updatedAt);
    if (existing && updatedAt <= existing.progress.updatedAt) return 'stale';
    await saveProgress(this.trx, this.ctx.parentId, { ...incoming, updatedAt }, this.seq.next());
    return null;
  }

  private async applySession(raw: unknown): Promise<SyncRejectionReason | null> {
    const incoming = this.parse(ReadingSessionSchema, raw);
    if (!incoming) return 'invalid';
    const refReason = PushSession.referenceReason(await this.child(incoming.childId))
      ?? PushSession.referenceReason(await this.document(incoming.documentId));
    if (refReason) return refReason;
    const existing = await findReadingSession(this.trx, incoming.id);
    if (existing && existing.parentId !== this.ctx.parentId) return 'forbidden';
    const updatedAt = this.clamp(incoming.updatedAt);
    if (existing && updatedAt <= existing.session.updatedAt) return 'stale';
    await saveReadingSession(this.trx, this.ctx.parentId, { ...incoming, updatedAt }, this.seq.next());
    return null;
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  }
  return value;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

function otherChildFieldsDiffer(existing: ChildProfile, incoming: ChildProfile): boolean {
  return existing.parentId !== incoming.parentId
    || existing.firstName !== incoming.firstName
    || existing.age !== incoming.age
    || existing.avatar !== incoming.avatar
    || existing.readingLevel !== incoming.readingLevel
    || existing.explanationDifficulty !== incoming.explanationDifficulty
    || existing.deletedAt !== incoming.deletedAt
    || !sameJson(existing.exercises, incoming.exercises);
}

/** Applies a push in one transaction (writers of the same parent are serialized by the counter lock). */
export async function applyPush(db: Knex, ctx: PushContext, changes: RawChanges): Promise<PushResult> {
  return db.transaction(async (trx) => {
    const seq = await openSeqAllocator(trx, ctx.parentId);
    const session = new PushSession(trx, seq, ctx);
    for (const table of PUSH_ORDER) {
      for (const raw of changes[table]) await session.apply(table, raw);
    }
    await seq.flush();
    return { rejected: session.rejected, restore: session.restore };
  });
}
