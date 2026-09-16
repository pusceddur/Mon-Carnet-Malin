import type { Id, Millis } from './domain';

export type InkTool = 'pencil' | 'pen' | 'highlighter';
export type EraserMode = 'stroke' | 'partial' | 'page';          // erase stroke / partial / whole page
export type Thickness = 'fin' | 'moyen' | 'epais';
export interface InkPoint { x: number; y: number; p: number /*pressure 0..1*/ }
export type InkSpace =
  | { kind: 'text'; pageIndex: number; blockIndex: number; charOffset: number; blockTextHash: string; contextText: string }
      // points in em, origin = top-left corner of the box of the word starting at charOffset
  | { kind: 'original'; pageIndex: number }
      // x = fraction of page width, y = fraction of page height (0..1)
  | { kind: 'answer'; exerciseId: Id; questionId: string };
      // x,y = fractions of the answer box WIDTH
export interface InkAnnotation {
  id: Id; type: 'ink'; childId: Id; documentId: Id | null;
  tool: InkTool; color: string /*#rrggbb*/; width: number /*same units as the space*/; opacity: number;
  space: InkSpace; points: InkPoint[];
  createdAt: Millis; updatedAt: Millis; deletedAt: Millis | null;
}
export interface TextHighlight {
  id: Id; type: 'highlight'; childId: Id; documentId: Id;
  color: string; pageIndex: number; blockIndex: number; start: number; end: number;  // char offsets in block [start,end)
  blockTextHash: string; text: string;
  createdAt: Millis; updatedAt: Millis; deletedAt: Millis | null;
}
export type Annotation = InkAnnotation | TextHighlight;
