// §19.2 text boxes on the original page: added with a tap, typed with a keyboard (or Scribble), read aloud, moved, resized.
import type { TextBoxAnnotation } from '@aide/shared';
import { act, useRef, type JSX } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { format } from '../../src/i18n/fr';
import { pencil as strings } from '../../src/i18n/fr/pencil';
import { TextBoxLayer } from '../../src/pencil';
import { addTextBox, finishTextBox, updateTextBox } from '../../src/pencil/AnnotationStore';
import { clearHistory, whenHistoryIdle } from '../../src/pencil/history';
import { resetPencilStore } from '../../src/pencil/store';
import { buttonByLabel, cleanup, click, mockRect, pointerEvent, render, waitFor } from './helpers';

const speech = vi.hoisted(() => ({ speakOnce: vi.fn() }));
vi.mock('../../src/tts/SpeechEngine', () => ({ speechEngine: { speakOnce: speech.speakOnce } }));
vi.mock('../../src/sync/SyncEngine', () => ({
  saveEntity: async (table: string, entity: unknown) => {
    const { db: localDb } = await import('../../src/db/localDb');
    await localDb.table(table).put(entity);
  },
}));

const t = strings.textBox;
const FRAME = { left: 0, top: 0, width: 1000, height: 1400 };
const DOC = 'doc-1';
const CHILD = 'child-1';

function Host({ editing, readable = true }: { editing: boolean; readable?: boolean }): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={(el) => {
        frameRef.current = el;
        if (el) mockRect(el, FRAME);
      }}
    >
      <TextBoxLayer documentId={DOC} childId={CHILD} pageIndex={0} frameRef={frameRef} frameWidth={FRAME.width} editing={editing} readable={readable} />
    </div>
  );
}

async function boxes(): Promise<TextBoxAnnotation[]> {
  return (await db.annotations.toArray()).filter((a): a is TextBoxAnnotation => a.type === 'textbox');
}

async function tap(target: Element, x: number, y: number): Promise<void> {
  await act(async () => {
    target.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', clientX: x, clientY: y }));
    target.dispatchEvent(pointerEvent('pointerup', { pointerType: 'touch', clientX: x, clientY: y, buttons: 0 }));
  });
}

async function typeIn(field: HTMLTextAreaElement, value: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function drag(handle: Element, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await act(async () => {
    handle.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', clientX: from.x, clientY: from.y }));
    handle.dispatchEvent(pointerEvent('pointermove', { pointerType: 'touch', clientX: to.x, clientY: to.y }));
    handle.dispatchEvent(pointerEvent('pointerup', { pointerType: 'touch', clientX: to.x, clientY: to.y, buttons: 0 }));
  });
}

async function selectBox(container: HTMLElement): Promise<void> {
  const element = await waitFor(() => container.querySelector('.tb-box'));
  await act(async () => {
    element.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', clientX: 150, clientY: 290 }));
  });
}

const seed = (patch: Partial<TextBoxAnnotation> = {}): Promise<TextBoxAnnotation> =>
  addTextBox({ documentId: DOC, childId: CHILD, pageIndex: 0, x: 0.1, y: 0.2, width: 0.4, fontSize: 0.022, color: '#1d4ed8', text: 'Bonjour', ...patch });

const stored = async (id: string): Promise<TextBoxAnnotation> => (await db.annotations.get(id)) as TextBoxAnnotation;

beforeEach(async () => {
  await db.open();
  await db.annotations.clear();
  clearHistory();
  resetPencilStore();
  speech.speakOnce.mockClear();
});

afterEach(cleanup);

afterAll(() => {
  db.close();
});

describe('text boxes on the original page (§19.2)', () => {
  it('a tap adds a box where the finger is; the typed text is saved; an empty box left behind disappears', async () => {
    const { container } = await render(<Host editing />);
    const layer = container.querySelector('.tb-layer')!;
    await tap(layer, 300, 700);
    const [box] = await waitFor(async () => {
      const list = await boxes();
      return list.length === 1 ? list : null;
    });
    const line = (0.022 * 1000 * 1.3) / 1400;
    expect(box).toMatchObject({ pageIndex: 0, x: 0.3, width: 0.45, fontSize: 0.022, color: '#1d4ed8', text: '', deletedAt: null });
    expect(box!.y).toBeCloseTo(0.5 - line / 2, 5);

    const field = await waitFor(() => container.querySelector<HTMLTextAreaElement>('.tb-box__input'));
    expect(field.getAttribute('aria-label')).toBe(t.label);
    await typeIn(field, 'Le chat dort.');
    await waitFor(async () => (await boxes())[0]?.text === 'Le chat dort.');

    // A tap next to it closes the box (text kept); the next tap adds another one, left empty.
    await tap(layer, 800, 1200);
    await tap(layer, 800, 1200);
    await waitFor(async () => (await boxes()).length === 2 && container.querySelectorAll('.tb-box--selected').length === 1);
    await tap(layer, 100, 100);
    const after = await waitFor(async () => {
      const list = await boxes();
      return list.length === 2 && list.every((b) => b.text !== '' || b.deletedAt !== null) ? list : null;
    });
    expect(after.filter((b) => b.deletedAt === null).map((b) => b.text)).toEqual(['Le chat dort.']);
  });

  it('tools of the box being written: read aloud, bigger, colour, delete', async () => {
    const box = await seed();
    const { container } = await render(<Host editing />);
    await selectBox(container);
    await click(await waitFor(() => buttonByLabel(t.read)));
    expect(speech.speakOnce).toHaveBeenCalledWith('Bonjour');

    await click(buttonByLabel(t.bigger));
    await waitFor(async () => (await stored(box.id)).fontSize > 0.022);
    expect((await stored(box.id)).fontSize).toBeCloseTo(0.0264, 6);

    await click(buttonByLabel(t.color));
    await waitFor(async () => (await stored(box.id)).color === '#111827');

    await click(buttonByLabel(t.remove));
    await waitFor(async () => (await stored(box.id)).deletedAt !== null);
  });

  it('the move and width handles keep the box inside the page', async () => {
    const box = await seed({ x: 0.1, y: 0.2, width: 0.4 });
    const { container } = await render(<Host editing />);
    await selectBox(container);
    await drag(await waitFor(() => buttonByLabel(t.move)), { x: 100, y: 100 }, { x: 300, y: 240 });
    await waitFor(async () => (await stored(box.id)).x > 0.1);
    let saved = await stored(box.id);
    expect(saved.x).toBeCloseTo(0.3, 6);
    expect(saved.y).toBeCloseTo(0.3, 6);

    await drag(buttonByLabel(t.resize)!, { x: 700, y: 500 }, { x: 1500, y: 500 });
    await waitFor(async () => (await stored(box.id)).width > 0.4);
    saved = await stored(box.id);
    expect(saved.width).toBeCloseTo(0.7, 6);
    expect(saved.text).toBe('Bonjour');
  });

  it('reading mode: a tap on a box reads it; while drawing the boxes are only shown', async () => {
    await seed({ text: 'Mon résumé' });
    const reading = await render(<Host editing={false} readable />);
    await click(await waitFor(() => buttonByLabel(format(t.listen, { text: 'Mon résumé' }))));
    expect(speech.speakOnce).toHaveBeenCalledWith('Mon résumé');
    expect(reading.container.querySelector('textarea')).toBeNull();

    await reading.rerender(<Host editing={false} readable={false} />);
    expect(reading.container.querySelector('button')).toBeNull();
    expect(reading.container.textContent).toContain('Mon résumé');
  });

  it('store: an empty box left behind is removed, the last text is saved, unchanged patches write nothing', async () => {
    const box = await seed({ text: '' });
    await finishTextBox(box.id, '   ');
    expect((await stored(box.id)).deletedAt).not.toBeNull();

    const kept = await seed({ text: 'Avant' });
    await finishTextBox(kept.id, 'Après');
    expect(await stored(kept.id)).toMatchObject({ text: 'Après', deletedAt: null });

    const before = (await stored(kept.id)).updatedAt;
    await updateTextBox(kept.id, { text: 'Après', color: '#1d4ed8' });
    await whenHistoryIdle();
    expect((await stored(kept.id)).updatedAt).toBe(before);
  });
});
