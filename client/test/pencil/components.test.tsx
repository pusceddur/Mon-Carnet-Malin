import type { InkAnnotation, TextHighlight } from '@aide/shared';
import { act, useRef, type JSX } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { pencil as strings } from '../../src/i18n/fr/pencil';
import { AnswerPad, InkLayer, PencilToolbar, usePencilStore } from '../../src/pencil';
import { clearHistory, whenHistoryIdle } from '../../src/pencil/history';
import { resetPencilStore } from '../../src/pencil/store';
import {
  buildReaderDom,
  buttonByLabel,
  cleanup,
  click,
  dispatchStroke,
  flowBlocks,
  line,
  mockRect,
  pageContent,
  render,
  waitFor,
  wordOf,
} from './helpers';

vi.mock('../../src/sync/SyncEngine', () => ({
  saveEntity: async (table: string, entity: unknown) => {
    const { db: localDb } = await import('../../src/db/localDb');
    await localDb.table(table).put(entity);
  },
}));

beforeEach(async () => {
  await db.open();
  await Promise.all([db.annotations.clear(), db.pages.clear()]);
  clearHistory();
  resetPencilStore();
});

afterEach(cleanup);

afterAll(() => {
  db.close();
});

describe('PencilToolbar', () => {
  it('is only shown in annotation mode, with French labels and large targets', async () => {
    await render(<PencilToolbar />);
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    await act(async () => usePencilStore.getState().setMode('annotation'));
    const toolbar = document.querySelector('[role="toolbar"]')!;
    expect(toolbar.getAttribute('aria-label')).toBe(strings.toolbar.label);
    const labels = Array.from(toolbar.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Crayon', 'Stylo', 'Surligneur', 'Gomme', 'Annuler', 'Refaire', 'Couleur et épaisseur', 'Plus d’options']);
    expect(Array.from(toolbar.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['✏️', '🖊️', '🖍️', '🧽', '↩️', '↪️', '🎨', '⋯']);
    expect(buttonByLabel('Annuler')!.disabled).toBe(true);
    expect(buttonByLabel('Crayon')!.className).toContain('ui-btn--child');
  });

  it('switches tools and picks colours and thickness in the popover', async () => {
    usePencilStore.getState().setMode('annotation');
    await render(<PencilToolbar />);
    await click(buttonByLabel('Surligneur'));
    expect(usePencilStore.getState()).toMatchObject({ tool: 'highlighter', color: '#fde047' });
    expect(buttonByLabel('Surligneur')!.getAttribute('aria-pressed')).toBe('true');

    await click(buttonByLabel('Couleur et épaisseur'));
    const dialog = document.querySelector('[role="dialog"]')!;
    const swatches = Array.from(dialog.querySelectorAll('.pencil-swatch'));
    expect(swatches.map((s) => s.getAttribute('aria-label'))).toEqual(['Jaune', 'Vert clair', 'Bleu clair', 'Rose']);
    await click(buttonByLabel('Rose', dialog));
    expect(usePencilStore.getState().color).toBe('#f9a8d4');
    const epais = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent?.includes('Épais'));
    await click(epais);
    expect(usePencilStore.getState().thickness).toBe('epais');

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('offers the eraser modes, finger drawing and the way back to reading in the ⋯ menu', async () => {
    usePencilStore.getState().setMode('annotation');
    await render(<PencilToolbar />);
    await click(buttonByLabel('Plus d’options'));
    const menu = document.querySelector('[role="dialog"]')!;
    const options = Array.from(menu.querySelectorAll('.pencil-menu__option')).map((o) => o.textContent);
    expect(options).toEqual(['🧽Effacer le trait', '✂️Gomme partielle', '🗑️Effacer la page']);
    await click(Array.from(menu.querySelectorAll<HTMLButtonElement>('.pencil-menu__option'))[1]);
    expect(usePencilStore.getState()).toMatchObject({ tool: 'eraser', eraserMode: 'partial' });

    await click(buttonByLabel('Plus d’options'));
    await click(document.querySelector('[role="switch"]'));
    expect(usePencilStore.getState().fingerDraws).toBe(true);
    const back = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Revenir à la lecture'));
    await click(back);
    expect(usePencilStore.getState().mode).toBe('lecture');
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });
});

describe('AnswerPad', () => {
  const props = { exerciseId: 'ex-1', questionId: 'q1', childId: 'child-a' };

  it('shows two exclusive tabs: no text field while drawing, no drawing surface while writing', async () => {
    const onTextChange = vi.fn();
    const view = await render(<AnswerPad {...props} onTextChange={onTextChange} />);
    const tabs = Array.from(view.container.querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.textContent)).toEqual(['✏️Dessiner', '⌨️Écrire']);
    expect(view.container.querySelector('textarea')).toBeNull();
    expect(view.container.querySelector('.answer-pad__box')).not.toBeNull();

    await click(tabs[1]);
    expect(view.container.querySelector('.answer-pad__box')).toBeNull();
    const textarea = view.container.querySelector('textarea')!;
    expect(view.container.textContent).toContain('Écris directement avec ton Apple Pencil dans la case');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, 'Parce qu’il veut voir la mer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onTextChange).toHaveBeenLastCalledWith('Parce qu’il veut voir la mer.');
  });

  it('can show a single panel without tabs', async () => {
    const view = await render(<AnswerPad {...props} only="draw" />);
    expect(view.container.querySelector('[role="tablist"]')).toBeNull();
    expect(view.container.querySelector('.answer-pad__box')).not.toBeNull();
  });

  it('saves pen strokes in the answer space (fractions of the box width) and undoes them', async () => {
    const onInkSaved = vi.fn();
    const view = await render(<AnswerPad {...props} onInkSaved={onInkSaved} />);
    const box = view.container.querySelector<HTMLElement>('.answer-pad__box')!;
    const svg = box.querySelector('svg.ink-layer__svg')!;
    mockRect(svg, { left: 100, top: 50, width: 600, height: 300 });
    await act(async () => {
      dispatchStroke(box, line({ x: 160, y: 110 }, { x: 400, y: 140 }, 12), { pointerType: 'pen' });
    });
    const saved = await waitFor(async () => (await db.annotations.toArray())[0] as InkAnnotation | undefined);
    expect(saved.space).toEqual({ kind: 'answer', exerciseId: 'ex-1', questionId: 'q1' });
    expect(saved.documentId).toBeNull();
    expect(saved.points[0]).toMatchObject({ x: 0.1, y: 0.1 });
    expect(saved.width).toBeCloseTo(0.14 / 24, 5);
    await waitFor(() => onInkSaved.mock.calls.length > 0);
    expect(onInkSaved).toHaveBeenCalledWith(saved.id);

    const undo = await waitFor(() => {
      const b = buttonByLabel('Annuler', view.container);
      return b && !b.disabled ? b : null;
    });
    await click(undo);
    await act(() => whenHistoryIdle());
    expect((await db.annotations.get(saved.id))?.deletedAt).not.toBeNull();
  });

  it('ignores finger strokes unless finger drawing is on', async () => {
    const view = await render(<AnswerPad {...props} />);
    const box = view.container.querySelector<HTMLElement>('.answer-pad__box')!;
    mockRect(box.querySelector('svg.ink-layer__svg')!, { left: 0, top: 0, width: 600, height: 300 });
    await act(async () => dispatchStroke(box, line({ x: 60, y: 60 }, { x: 200, y: 60 }), { pointerType: 'touch' }));
    await act(() => whenHistoryIdle());
    expect(await db.annotations.count()).toBe(0);
    await click(buttonByLabel('Dessiner avec le doigt', view.container));
    await act(async () => dispatchStroke(box, line({ x: 60, y: 60 }, { x: 200, y: 60 }), { pointerType: 'touch', pointerId: 4 }));
    await waitFor(async () => (await db.annotations.count()) === 1);
    expect(box.style.touchAction).toBe('none');
  });
});

describe('InkLayer (text view)', () => {
  const DOC = 'doc-ink';
  const CHILD = 'child-ink';
  const TEXTS = ['Le petit renard traverse la forêt enneigée pour retrouver sa famille avant la nuit.'];
  const blocks = flowBlocks(TEXTS, { fontSize: 20, columnEm: 22, lineHeight: 1.8 });

  function Reader(): JSX.Element {
    const pageRef = useRef<HTMLElement | null>(null);
    return (
      <article className="reader">
        <section
          ref={(el) => {
            pageRef.current = el;
            if (el && !el.querySelector('.rp-block')) {
              const dom = buildReaderDom(0, blocks);
              el.append(...Array.from(dom.childNodes));
              dom.remove();
            }
          }}
          className="rp-page"
        >
          <InkLayer documentId={DOC} childId={CHILD} view="text" pageIndex={0} containerRef={pageRef} layoutKey="k1" />
        </section>
      </article>
    );
  }

  async function mountReader(): Promise<{ page: HTMLElement }> {
    await db.pages.put(pageContent(DOC, 0, TEXTS));
    const view = await render(<Reader />);
    const page = view.container.querySelector<HTMLElement>('.rp-page')!;
    for (const svg of Array.from(page.querySelectorAll('svg'))) mockRect(svg, { left: 0, top: 0, width: 800, height: 600 });
    return { page };
  }

  it('lets the finger scroll and the pen do nothing in reading mode', async () => {
    const { page } = await mountReader();
    await act(async () => dispatchStroke(page, line({ x: 50, y: 60 }, { x: 300, y: 60 }), { pointerType: 'pen' }));
    await act(() => whenHistoryIdle());
    expect(await db.annotations.count()).toBe(0);
    expect(page.style.touchAction).toBe('');
  });

  it('anchors a pen stroke to the word, snaps the highlighter, erases and undoes', async () => {
    const { page } = await mountReader();
    await act(async () => {
      usePencilStore.getState().setMode('annotation');
      usePencilStore.getState().setTool('pen');
    });
    const renard = wordOf(blocks, 0, 'renard');
    const y = renard.rect.top + renard.rect.height + 2;
    await act(async () => dispatchStroke(page, line({ x: renard.rect.left, y }, { x: renard.rect.left + renard.rect.width, y }, 10), { pointerType: 'pen' }));
    const ink = await waitFor(async () => (await db.annotations.toArray()).find((a): a is InkAnnotation => a.type === 'ink'));
    expect(ink.space).toMatchObject({ kind: 'text', blockIndex: 0, charOffset: renard.o, endAnchor: null });
    expect(ink.tool).toBe('pen');
    expect(ink.width).toBeCloseTo(0.1);

    // Rendered after the liveQuery update.
    await waitFor(() => page.querySelector(`path[data-ink-id="${ink.id}"]`));

    await act(async () => usePencilStore.getState().setTool('highlighter'));
    const foret = wordOf(blocks, 0, 'forêt');
    const mid = foret.rect.top + foret.rect.height / 2;
    const la = wordOf(blocks, 0, 'la');
    await act(async () => dispatchStroke(page, line({ x: la.rect.left + 2, y: mid }, { x: foret.rect.left + foret.rect.width - 2, y: mid }), { pointerType: 'pen', pointerId: 2 }));
    const hl = await waitFor(async () => (await db.annotations.toArray()).find((a): a is TextHighlight => a.type === 'highlight'));
    expect(hl).toMatchObject({ blockIndex: 0, start: la.o, end: foret.o + 'forêt'.length, text: 'la forêt', pageIndex: 0, deletedAt: null });

    await act(async () => usePencilStore.getState().setEraserMode('stroke'));
    const eraseAt = { x: renard.rect.left + renard.rect.width / 2, y };
    await act(async () => dispatchStroke(page, [eraseAt, { x: eraseAt.x + 3, y: eraseAt.y }], { pointerType: 'pen', pointerId: 3 }));
    await waitFor(async () => (await db.annotations.get(ink.id))?.deletedAt !== null);
    expect((await db.annotations.get(hl.id))?.deletedAt).toBeNull();

    await act(async () => usePencilStore.getState().undo());
    await act(() => whenHistoryIdle());
    expect((await db.annotations.get(ink.id))?.deletedAt).toBeNull();
  });

  it('splits a stroke with the partial eraser into fragments anchored to the text, as one undoable action', async () => {
    const { page } = await mountReader();
    await act(async () => {
      usePencilStore.getState().setMode('annotation');
      usePencilStore.getState().setTool('pencil');
    });
    const words = blocks[0]!.words.filter((w) => w.line === 0);
    const first = words[0]!;
    const last = words[words.length - 1]!;
    const y = first.rect.top + first.rect.height + 2;
    await act(async () => dispatchStroke(page, line({ x: first.rect.left, y }, { x: last.rect.left + last.rect.width, y }, 30), { pointerType: 'pen' }));
    const original = await waitFor(async () => (await db.annotations.toArray())[0] as InkAnnotation | undefined);
    await waitFor(() => page.querySelector(`path[data-ink-id="${original.id}"]`));

    await act(async () => usePencilStore.getState().setEraserMode('partial'));
    const middle = (first.rect.left + last.rect.left + last.rect.width) / 2;
    await act(async () => dispatchStroke(page, line({ x: middle, y: y - 15 }, { x: middle, y: y + 15 }, 6), { pointerType: 'pen', pointerId: 5 }));
    const fragments = await waitFor(async () => {
      const all = await db.annotations.toArray();
      const live = all.filter((a): a is InkAnnotation => a.type === 'ink' && a.deletedAt === null);
      return live.length === 2 && live.every((a) => a.id !== original.id) ? live : null;
    });
    for (const f of fragments) {
      expect(f).toMatchObject({ tool: 'pencil', color: original.color, opacity: original.opacity, space: { kind: 'text', pageIndex: 0, blockIndex: 0 } });
    }
    const [left, right] = [...fragments].sort((a, b) => (a.space.kind === 'text' && b.space.kind === 'text' ? a.space.charOffset - b.space.charOffset : 0));
    expect(left!.space.kind === 'text' && right!.space.kind === 'text' && left!.space.charOffset < right!.space.charOffset).toBe(true);

    await act(async () => usePencilStore.getState().undo());
    await act(() => whenHistoryIdle());
    expect((await db.annotations.get(original.id))?.deletedAt).toBeNull();
    for (const f of fragments) expect((await db.annotations.get(f.id))?.deletedAt).not.toBeNull();
  });

  it('asks for confirmation before clearing the page with the page eraser', async () => {
    const { page } = await mountReader();
    const existing: InkAnnotation = {
      id: 'existing', type: 'ink', childId: CHILD, documentId: DOC, tool: 'pencil', color: '#1f2937', width: 0.14, opacity: 0.9,
      space: { kind: 'text', pageIndex: 0, blockIndex: 0, charOffset: 0, blockTextHash: 'b'.repeat(64), contextText: 'Le petit', endAnchor: null },
      points: [{ x: 0, y: 1.3, p: 0.5 }, { x: 2, y: 1.3, p: 0.5 }], createdAt: 1, updatedAt: 1, deletedAt: null,
    };
    await act(async () => {
      await db.annotations.put(existing);
    });
    await act(async () => {
      usePencilStore.getState().setMode('annotation');
      usePencilStore.getState().setEraserMode('page');
    });
    await act(async () => dispatchStroke(page, [{ x: 100, y: 100 }], { pointerType: 'pen' }));
    const dialog = await waitFor(() => document.querySelector('[role="alertdialog"]'));
    expect(dialog.textContent).toContain('Effacer toute la page ?');
    await click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.includes('Tout effacer')));
    await waitFor(async () => (await db.annotations.get('existing'))?.deletedAt !== null);
  });
});

describe('InkLayer (original view)', () => {
  const DOC = 'doc-scan';
  const CHILD = 'child-scan';

  function Scan(): JSX.Element {
    const frameRef = useRef<HTMLDivElement | null>(null);
    return (
      <div ref={frameRef} className="frame">
        <img alt="" src="data:," width={1000} height={1500} />
        <InkLayer documentId={DOC} childId={CHILD} view="original" pageIndex={2} containerRef={frameRef} imageSize={{ width: 1000, height: 1500 }} layoutKey="z1" />
      </div>
    );
  }

  it('stores highlighter strokes normalised to the page image (no text snapping)', async () => {
    const view = await render(<Scan />);
    const frame = view.container.querySelector<HTMLElement>('.frame')!;
    for (const svg of Array.from(frame.querySelectorAll('svg'))) mockRect(svg, { left: 0, top: 0, width: 400, height: 600 });
    mockRect(frame.querySelector('img')!, { left: 0, top: 0, width: 400, height: 600 });
    await act(async () => {
      usePencilStore.getState().setMode('annotation');
      usePencilStore.getState().setTool('highlighter');
    });
    await act(async () => dispatchStroke(frame, line({ x: 40, y: 300 }, { x: 360, y: 300 }), { pointerType: 'pen' }));
    const saved = await waitFor(async () => (await db.annotations.toArray())[0] as InkAnnotation | undefined);
    expect(saved).toMatchObject({ type: 'ink', tool: 'highlighter', color: '#fde047', space: { kind: 'original', pageIndex: 2 } });
    expect(saved.points[0]).toMatchObject({ x: 0.1, y: 0.5 });
    expect(saved.points[saved.points.length - 1]).toMatchObject({ x: 0.9, y: 0.5 });
    expect(saved.width).toBeCloseTo(1 / 45, 4);
    const path = await waitFor(() => frame.querySelector(`.ink-layer__svg--highlighter path[data-ink-id="${saved.id}"]`));
    expect(path.getAttribute('fill')).toBe('#fde047');
  });
});
