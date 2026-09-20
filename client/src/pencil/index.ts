// Public API of the pencil module (contract §11.5, §15.7).
export { usePencilStore, resetPencilStore, type PencilActions, type PencilExtraState, type PencilState, type PencilStore, type ReaderMode } from './store';
export { InkLayer, type InkLayerProps } from './InkLayer';
export { PencilToolbar } from './PencilToolbar';
export { AnswerPad, type AnswerPadProps, type AnswerPadTab } from './AnswerPad';
export { TextBoxLayer, TEXT_BOX_COLORS, type TextBoxLayerProps } from './TextBoxLayer';
export {
  addTextHighlight,
  clearAnswerInk,
  clearPageAnnotations,
  getAnswerInk,
  getOrphanAnnotations,
  removeAnnotation,
  useAnnotations,
  useAnswerInk,
  useOrphanAnnotations,
  useTextHighlights,
  type PageTarget,
} from './AnnotationStore';
export {
  annotationPageIndex,
  blockTextHash,
  isOrphanAnnotation,
  reanchor,
  reanchorAnnotation,
  reanchorPageAnnotations,
  type ReanchorResult,
  type ReanchorSource,
} from './anchoring';
export { answerInkToPngBase64, answerInkToSvg } from './exportInk';
export { answerHistoryKey, documentHistoryKey } from './history';
export { COLOR_LABELS, HIGHLIGHTER_PALETTE, INK_PALETTE } from './Tools';
export { startPencilPreferences } from './preferences';
