// Undo/redo stacks per history key (one per document+child, one per answer box) and a serial execution queue.
import type { Annotation, Id } from '@aide/shared';

/**
 * Every undoable action is expressed as annotations created and annotations deleted:
 * add stroke / highlight = created; erase = deleted; partial erase = deleted original + created fragments;
 * clear page = deleted.
 */
export interface AnnotationCommand {
  created: readonly Annotation[];
  deleted: readonly Annotation[];
}

export type HistoryDirection = 'undo' | 'redo';
export type CommandApplier = (command: AnnotationCommand, direction: HistoryDirection) => Promise<void>;

export const HISTORY_LIMIT = 100;

interface Stacks { undo: AnnotationCommand[]; redo: AnnotationCommand[] }

const stacks = new Map<string, Stacks>();
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();

export function documentHistoryKey(documentId: Id, childId: Id): string {
  return `doc:${documentId}:${childId}`;
}

export function answerHistoryKey(exerciseId: Id, questionId: string, childId: Id): string {
  return `answer:${exerciseId}:${questionId}:${childId}`;
}

function stacksFor(key: string): Stacks {
  let s = stacks.get(key);
  if (!s) {
    s = { undo: [], redo: [] };
    stacks.set(key, s);
  }
  return s;
}

function notify(): void {
  for (const listener of Array.from(listeners)) listener();
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function historyFlags(key: string | null): { canUndo: boolean; canRedo: boolean } {
  const s = key === null ? undefined : stacks.get(key);
  return { canUndo: (s?.undo.length ?? 0) > 0, canRedo: (s?.redo.length ?? 0) > 0 };
}

/** Records a performed action: clears the redo stack of that key. Empty commands are ignored. */
export function pushCommand(key: string, command: AnnotationCommand): void {
  if (command.created.length === 0 && command.deleted.length === 0) return;
  const s = stacksFor(key);
  s.undo.push(command);
  if (s.undo.length > HISTORY_LIMIT) s.undo.splice(0, s.undo.length - HISTORY_LIMIT);
  s.redo = [];
  notify();
}

/** Runs async work after every previously queued piece of work (writes and undo/redo never interleave). */
export function runExclusive<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/** Resolves when the queue is idle (tests). */
export function whenHistoryIdle(): Promise<void> {
  return runExclusive(async () => undefined);
}

async function step(key: string, direction: HistoryDirection, apply: CommandApplier): Promise<boolean> {
  const s = stacks.get(key);
  const from = direction === 'undo' ? s?.undo : s?.redo;
  const command = from?.pop();
  if (!s || !command) return false;
  notify();
  try {
    await apply(command, direction);
    (direction === 'undo' ? s.redo : s.undo).push(command);
    notify();
    return true;
  } catch (error) {
    from!.push(command);
    notify();
    throw error;
  }
}

/** Undoes the last action of `key`. Resolves false when there is nothing to undo; rejects (stack restored) on write failure. */
export function undoCommand(key: string, apply: CommandApplier): Promise<boolean> {
  return runExclusive(() => step(key, 'undo', apply));
}

export function redoCommand(key: string, apply: CommandApplier): Promise<boolean> {
  return runExclusive(() => step(key, 'redo', apply));
}

export function clearHistory(key?: string): void {
  if (key === undefined) stacks.clear();
  else stacks.delete(key);
  notify();
}
