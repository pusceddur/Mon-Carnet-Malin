import type { Annotation, InkAnnotation, TextHighlight } from '@aide/shared';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import {
  addAnnotations,
  addTextHighlight,
  clearAnswerInk,
  clearPageAnnotations,
  getAnswerInk,
  removeAnnotation,
  replaceAnnotations,
} from '../../src/pencil/AnnotationStore';
import { HISTORY_LIMIT, answerHistoryKey, clearHistory, documentHistoryKey, historyFlags, pushCommand, undoCommand, whenHistoryIdle } from '../../src/pencil/history';
import { resetPencilStore, usePencilStore } from '../../src/pencil/store';

vi.mock('../../src/sync/SyncEngine', () => ({
  saveEntity: vi.fn(async (table: string, entity: unknown) => {
    const { db: localDb } = await import('../../src/db/localDb');
    await localDb.table(table).put(entity);
  }),
}));

const DOC = 'doc-history';
const CHILD = 'child-h';
const KEY = documentHistoryKey(DOC, CHILD);
const HASH = 'a'.repeat(64);

let counter = 0;
function stroke(overrides: Partial<InkAnnotation> = {}): InkAnnotation {
  counter++;
  return {
    id: `ink-${counter}`, type: 'ink', childId: CHILD, documentId: DOC, tool: 'pencil', color: '#1f2937', width: 0.14, opacity: 0.9,
    space: { kind: 'original', pageIndex: 0 }, points: [{ x: 0.1, y: 0.1, p: 0.5 }, { x: 0.2, y: 0.2, p: 0.5 }],
    createdAt: 1, updatedAt: 1, deletedAt: null, ...overrides,
  };
}

async function deletedState(ids: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const id of ids) out[id] = (await db.annotations.get(id))?.deletedAt !== null;
  return out;
}

async function undo(): Promise<void> {
  usePencilStore.getState().undo();
  await whenHistoryIdle();
}

async function redo(): Promise<void> {
  usePencilStore.getState().redo();
  await whenHistoryIdle();
}

beforeEach(async () => {
  await db.open();
  await db.annotations.clear();
  clearHistory();
  resetPencilStore();
});

afterAll(() => {
  db.close();
});

describe('pencil store', () => {
  it('remembers colour and thickness per tool and restricts colours to the tool palette', () => {
    const s = usePencilStore.getState();
    expect(s).toMatchObject({ mode: 'lecture', tool: 'pencil', color: '#1f2937', thickness: 'moyen', fingerDraws: false, canUndo: false });
    s.setColor('#DC2626');
    s.setThickness('fin');
    s.setTool('highlighter');
    expect(usePencilStore.getState()).toMatchObject({ tool: 'highlighter', color: '#fde047', thickness: 'moyen' });
    usePencilStore.getState().setColor('#dc2626'); // not a highlighter colour
    expect(usePencilStore.getState().color).toBe('#fde047');
    usePencilStore.getState().setColor('#93c5fd');
    usePencilStore.getState().setTool('eraser');
    expect(usePencilStore.getState()).toMatchObject({ tool: 'eraser', color: '#93c5fd', lastInkTool: 'highlighter' });
    usePencilStore.getState().setTool('pencil');
    expect(usePencilStore.getState()).toMatchObject({ color: '#dc2626', thickness: 'fin' });
  });

  it('selects the eraser when an eraser mode is chosen', () => {
    usePencilStore.getState().setEraserMode('partial');
    expect(usePencilStore.getState()).toMatchObject({ tool: 'eraser', eraserMode: 'partial' });
  });

  it('turns finger drawing off when the first pen is detected, only once', () => {
    const s = usePencilStore.getState();
    s.setFingerDraws(true);
    s.notePenDetected();
    expect(usePencilStore.getState()).toMatchObject({ fingerDraws: false, penDetected: true });
    usePencilStore.getState().setFingerDraws(true);
    usePencilStore.getState().notePenDetected();
    expect(usePencilStore.getState().fingerDraws).toBe(true);
  });
});

describe('undo / redo per document', () => {
  it('undoes and redoes an added stroke', async () => {
    const release = usePencilStore.getState().activateHistory(KEY);
    const a = stroke();
    await addAnnotations([a], KEY);
    expect(usePencilStore.getState()).toMatchObject({ canUndo: true, canRedo: false });

    await undo();
    expect(await deletedState([a.id])).toEqual({ [a.id]: true });
    expect(usePencilStore.getState()).toMatchObject({ canUndo: false, canRedo: true });

    await redo();
    const restored = await db.annotations.get(a.id);
    expect(restored?.deletedAt).toBeNull();
    expect(restored!.updatedAt).toBeGreaterThan(1);
    release();
    expect(usePencilStore.getState()).toMatchObject({ historyKey: null, canUndo: false });
  });

  it('undoes a partial erase as one action (fragments removed, original restored)', async () => {
    usePencilStore.getState().activateHistory(KEY);
    const original = stroke();
    await addAnnotations([original], KEY);
    const fragments = [stroke(), stroke()];
    await replaceAnnotations([original], fragments, KEY);
    const ids = [original.id, ...fragments.map((f) => f.id)];
    expect(await deletedState(ids)).toEqual({ [original.id]: true, [fragments[0]!.id]: false, [fragments[1]!.id]: false });

    await undo();
    expect(await deletedState(ids)).toEqual({ [original.id]: false, [fragments[0]!.id]: true, [fragments[1]!.id]: true });
    await redo();
    expect(await deletedState(ids)).toEqual({ [original.id]: true, [fragments[0]!.id]: false, [fragments[1]!.id]: false });
  });

  it('clears a page (ink of the view + highlights in the text view) and restores it with undo', async () => {
    usePencilStore.getState().activateHistory(KEY);
    const onPage = stroke();
    const otherView = stroke({ space: { kind: 'text', pageIndex: 0, blockIndex: 0, charOffset: 0, blockTextHash: HASH, contextText: 'La', endAnchor: null } });
    const otherPage = stroke({ space: { kind: 'original', pageIndex: 1 } });
    await addAnnotations([onPage, otherView, otherPage], KEY);
    const highlight = await addTextHighlight({ childId: CHILD, documentId: DOC, color: '#fde047', pageIndex: 0, blockIndex: 0, start: 0, end: 2, blockTextHash: HASH, text: 'La' });

    expect(await clearPageAnnotations({ documentId: DOC, childId: CHILD, pageIndex: 0, view: 'original' })).toBe(1);
    expect(await deletedState([onPage.id, otherView.id, otherPage.id, highlight.id])).toEqual({ [onPage.id]: true, [otherView.id]: false, [otherPage.id]: false, [highlight.id]: false });
    expect(await clearPageAnnotations({ documentId: DOC, childId: CHILD, pageIndex: 0, view: 'text' })).toBe(2);

    await undo();
    expect(await deletedState([otherView.id, highlight.id])).toEqual({ [otherView.id]: false, [highlight.id]: false });
    await undo();
    expect(await deletedState([onPage.id])).toEqual({ [onPage.id]: false });
    await undo(); // highlight
    expect(await deletedState([highlight.id])).toEqual({ [highlight.id]: true });
  });

  it('records highlights and removals made by the reader', async () => {
    usePencilStore.getState().activateHistory(KEY);
    const h: TextHighlight = await addTextHighlight({ childId: CHILD, documentId: DOC, color: '#86efac', pageIndex: 3, blockIndex: 1, start: 4, end: 9, blockTextHash: HASH, text: 'arbre' });
    expect(h).toMatchObject({ type: 'highlight', deletedAt: null });
    await removeAnnotation(h.id);
    await removeAnnotation('missing');
    expect((await db.annotations.get(h.id))?.deletedAt).not.toBeNull();
    await undo();
    expect((await db.annotations.get(h.id))?.deletedAt).toBeNull();
  });

  it('keeps separate stacks per document and follows the active surface', async () => {
    const otherKey = documentHistoryKey('other-doc', CHILD);
    const releaseA = usePencilStore.getState().activateHistory(KEY);
    await addAnnotations([stroke()], KEY);
    const releaseB = usePencilStore.getState().activateHistory(otherKey);
    expect(usePencilStore.getState()).toMatchObject({ historyKey: otherKey, canUndo: false });
    usePencilStore.getState().focusHistory(KEY);
    expect(usePencilStore.getState()).toMatchObject({ historyKey: KEY, canUndo: true });
    releaseA();
    expect(usePencilStore.getState().historyKey).toBe(otherKey);
    releaseB();
  });

  it('restores the stack when a write fails during undo', async () => {
    const command = { created: [stroke()] as Annotation[], deleted: [] };
    pushCommand(KEY, command);
    await expect(undoCommand(KEY, async () => { throw new Error('quota'); })).rejects.toThrow('quota');
    expect(historyFlags(KEY)).toEqual({ canUndo: true, canRedo: false });
    await expect(undoCommand('nothing', async () => undefined)).resolves.toBe(false);
  });

  it('flags the error in the store when undo cannot be written', async () => {
    usePencilStore.getState().activateHistory(KEY);
    const a = stroke();
    await addAnnotations([a], KEY);
    const { saveEntity } = await import('../../src/sync/SyncEngine');
    vi.mocked(saveEntity).mockRejectedValueOnce(new Error('disk full'));
    await undo();
    await Promise.resolve();
    expect(usePencilStore.getState()).toMatchObject({ historyError: true, canUndo: true });
  });

  it('limits the history depth', () => {
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) pushCommand(KEY, { created: [stroke()], deleted: [] });
    let count = 0;
    const apply = async (): Promise<void> => undefined;
    return (async () => {
      while (await undoCommand(KEY, apply)) count++;
      expect(count).toBe(HISTORY_LIMIT);
    })();
  });
});

describe('answer ink', () => {
  it('lists, clears and restores the strokes of one answer box', async () => {
    const key = answerHistoryKey('ex-1', 'q1', CHILD);
    const space = { kind: 'answer' as const, exerciseId: 'ex-1', questionId: 'q1' };
    const first = stroke({ documentId: null, space, createdAt: 5 });
    const second = stroke({ documentId: null, space, createdAt: 2 });
    const otherQuestion = stroke({ documentId: null, space: { ...space, questionId: 'q2' } });
    await addAnnotations([first, second, otherQuestion], key);
    expect((await getAnswerInk('ex-1', 'q1', CHILD)).map((a) => a.id)).toEqual([second.id, first.id]);
    expect(await clearAnswerInk('ex-1', 'q1', CHILD)).toBe(2);
    expect(await getAnswerInk('ex-1', 'q1', CHILD)).toHaveLength(0);
    usePencilStore.getState().activateHistory(key);
    await undo();
    expect(await getAnswerInk('ex-1', 'q1', CHILD)).toHaveLength(2);
  });
});
