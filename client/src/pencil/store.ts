// STUB: client-pencil (store is functional; undo/redo wiring pending DrawingEngine/AnnotationStore)
import { INK_COLORS, type EraserMode, type InkTool, type Thickness } from '@aide/shared';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

export type ReaderMode = 'lecture' | 'annotation';
export interface PencilState { mode: ReaderMode; tool: InkTool | 'eraser'; eraserMode: EraserMode; color: string; thickness: Thickness; fingerDraws: boolean; canUndo: boolean; canRedo: boolean }
export interface PencilActions {
  setMode(m: ReaderMode): void;
  setTool(t: PencilState['tool']): void;
  setColor(c: string): void;
  setThickness(t: Thickness): void;
  setEraserMode(m: EraserMode): void;
  setFingerDraws(v: boolean): void;
  undo(): void;
  redo(): void;
}
export type PencilStore = PencilState & PencilActions;

export const usePencilStore: UseBoundStore<StoreApi<PencilStore>> = create<PencilStore>()((set) => ({
  mode: 'lecture',
  tool: 'pencil',
  eraserMode: 'stroke',
  color: INK_COLORS.noir,
  thickness: 'moyen',
  fingerDraws: false,
  canUndo: false,
  canRedo: false,
  setMode: (mode) => set({ mode }),
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setThickness: (thickness) => set({ thickness }),
  setEraserMode: (eraserMode) => set({ eraserMode }),
  setFingerDraws: (fingerDraws) => set({ fingerDraws }),
  undo: () => {},
  redo: () => {},
}));
