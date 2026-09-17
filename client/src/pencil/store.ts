// Pencil UI state (zustand): reader mode, tool, colour, thickness, eraser mode, finger drawing, undo/redo of the active document.
import type { EraserMode, InkTool, Thickness } from '@aide/shared';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { applyCommand } from './AnnotationStore';
import { historyFlags, redoCommand, subscribeHistory, undoCommand } from './history';
import { INK_TOOLS, TOOL_PRESETS, isInPalette } from './Tools';

export type ReaderMode = 'lecture' | 'annotation';

export interface PencilState {
  mode: ReaderMode;
  tool: InkTool | 'eraser';
  eraserMode: EraserMode;
  /** Colour of the current ink tool (of the last ink tool while the eraser is selected). */
  color: string;
  /** Thickness of the current ink tool (of the last ink tool while the eraser is selected). */
  thickness: Thickness;
  fingerDraws: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface PencilExtraState {
  /** Ink tool used for colour/thickness while the eraser is selected. */
  lastInkTool: InkTool;
  colorByTool: Readonly<Record<InkTool, string>>;
  thicknessByTool: Readonly<Record<InkTool, Thickness>>;
  /** A pen has been seen during this session. */
  penDetected: boolean;
  /** History key targeted by undo/redo (most recently activated surface). */
  historyKey: string | null;
  /** Last undo/redo failure (for a toast), cleared by the next success. */
  historyError: boolean;
}

export interface PencilActions {
  setMode(m: ReaderMode): void;
  setTool(t: PencilState['tool']): void;
  setColor(c: string): void;
  setThickness(t: Thickness): void;
  setEraserMode(m: EraserMode): void;
  setFingerDraws(v: boolean): void;
  undo(): void;
  redo(): void;
  /** First pen seen ⇒ « Dessiner avec le doigt » off (§15.7). Later calls do nothing. */
  notePenDetected(): void;
  /** Makes `key` the undo/redo target while the returned release function has not been called. */
  activateHistory(key: string): () => void;
  /** Brings an already activated key back on top (the child is writing on that surface). */
  focusHistory(key: string): void;
}

export type PencilStore = PencilState & PencilExtraState & PencilActions;

const activations: { token: number; key: string }[] = [];
let nextToken = 1;

function initialState(): PencilState & PencilExtraState {
  const colorByTool: Record<InkTool, string> = { pencil: TOOL_PRESETS.pencil.defaultColor, pen: TOOL_PRESETS.pen.defaultColor, highlighter: TOOL_PRESETS.highlighter.defaultColor };
  const thicknessByTool: Record<InkTool, Thickness> = { pencil: 'moyen', pen: 'moyen', highlighter: 'moyen' };
  return {
    mode: 'lecture',
    tool: 'pencil',
    eraserMode: 'stroke',
    color: colorByTool.pencil,
    thickness: thicknessByTool.pencil,
    fingerDraws: false,
    canUndo: false,
    canRedo: false,
    lastInkTool: 'pencil',
    colorByTool,
    thicknessByTool,
    penDetected: false,
    historyKey: null,
    historyError: false,
  };
}

export const usePencilStore: UseBoundStore<StoreApi<PencilStore>> = create<PencilStore>()((set, get) => {
  const refreshHistory = (): void => {
    const top = activations[activations.length - 1];
    const key = top?.key ?? null;
    set({ historyKey: key, ...historyFlags(key) });
  };

  const runHistory = (direction: 'undo' | 'redo'): void => {
    const key = get().historyKey;
    if (key === null) return;
    const run = direction === 'undo' ? undoCommand : redoCommand;
    run(key, applyCommand).then(
      () => set({ historyError: false }),
      () => set({ historyError: true }),
    );
  };

  subscribeHistory(refreshHistory);

  return {
    ...initialState(),
    setMode: (mode) => set({ mode }),
    setTool: (tool) => {
      if (tool === 'eraser') {
        set({ tool });
        return;
      }
      const { colorByTool, thicknessByTool } = get();
      set({ tool, lastInkTool: tool, color: colorByTool[tool], thickness: thicknessByTool[tool] });
    },
    setColor: (color) => {
      const { lastInkTool, colorByTool } = get();
      const c = color.toLowerCase();
      if (!isInPalette(lastInkTool, c)) return;
      set({ color: c, colorByTool: { ...colorByTool, [lastInkTool]: c } });
    },
    setThickness: (thickness) => {
      const { lastInkTool, thicknessByTool } = get();
      set({ thickness, thicknessByTool: { ...thicknessByTool, [lastInkTool]: thickness } });
    },
    setEraserMode: (eraserMode) => set({ eraserMode, tool: 'eraser' }),
    setFingerDraws: (fingerDraws) => set({ fingerDraws }),
    undo: () => runHistory('undo'),
    redo: () => runHistory('redo'),
    notePenDetected: () => {
      if (get().penDetected) return;
      set({ penDetected: true, fingerDraws: false });
    },
    activateHistory: (key) => {
      const token = nextToken++;
      activations.push({ token, key });
      refreshHistory();
      return () => {
        const index = activations.findIndex((a) => a.token === token);
        if (index !== -1) activations.splice(index, 1);
        refreshHistory();
      };
    },
    focusHistory: (key) => {
      let index = -1;
      for (let i = activations.length - 1; i >= 0; i--) {
        if (activations[i]!.key === key) {
          index = i;
          break;
        }
      }
      if (index === -1 || index === activations.length - 1) return;
      const [entry] = activations.splice(index, 1);
      activations.push(entry!);
      refreshHistory();
    },
  };
});

/** Resets the store to its defaults (tests, child switch). History stacks are not cleared. */
export function resetPencilStore(): void {
  activations.length = 0;
  usePencilStore.setState({ ...initialState() });
}

export function isInkTool(tool: PencilState['tool']): tool is InkTool {
  return (INK_TOOLS as readonly string[]).includes(tool);
}
