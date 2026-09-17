import { LIMITS, type Annotation, type Id, type InkAnnotation } from '@aide/shared';
import { requestAI } from '../../../ai/aiClient';
import { db } from '../../../db/localDb';
import { kidMessage } from './aiResults';

export interface RasterStroke { points: { x: number; y: number }[]; lineWidth: number }
export interface InkRaster { width: number; height: number; strokes: RasterStroke[] }

const BOX_WIDTH_PX = 1000;
const PADDING_PX = 24;
const MAX_SIDE_PX = 1600;
const PNG_PREFIX = 'data:image/png;base64,';

export function isAnswerInk(a: Annotation, exerciseId: Id, questionId: string): a is InkAnnotation {
  return a.type === 'ink' && a.deletedAt === null && a.space.kind === 'answer'
    && a.space.exerciseId === exerciseId && a.space.questionId === questionId;
}

// Answer ink cannot predate its exercise; the margin absorbs clock differences between devices.
const CLOCK_MARGIN_MS = 10 * 60_000;

/**
 * Non-deleted ink strokes drawn in the answer box of a question. `exerciseCreatedAt` bounds the scan to recent
 * annotations (the reader may hold thousands of strokes).
 */
export async function loadAnswerInk(childId: Id, exerciseId: Id, questionId: string, exerciseCreatedAt = 0): Promise<InkAnnotation[]> {
  const recent = await db.annotations
    .where('updatedAt')
    .aboveOrEqual(Math.max(0, exerciseCreatedAt - CLOCK_MARGIN_MS))
    .filter((a) => a.childId === childId && isAnswerInk(a, exerciseId, questionId))
    .toArray();
  return recent.filter((a): a is InkAnnotation => a.type === 'ink').sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Pixel geometry of the strokes (answer space: x and y are fractions of the box width), cropped to the ink with a
 * margin and scaled down so the longest side is at most `maxSide`. Highlighter strokes are ignored when other ink exists.
 */
export function planInkRaster(annotations: readonly InkAnnotation[], maxSide: number = MAX_SIDE_PX): InkRaster | null {
  const writing = annotations.filter((a) => a.tool !== 'highlighter');
  const source = (writing.length > 0 ? writing : annotations).filter((a) => a.points.length > 0);
  if (source.length === 0) return null;

  const strokes = source.map((a) => ({
    points: a.points.map((p) => ({ x: p.x * BOX_WIDTH_PX, y: p.y * BOX_WIDTH_PX })),
    lineWidth: Math.min(40, Math.max(2, a.width * BOX_WIDTH_PX)),
  }));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    const half = stroke.lineWidth / 2;
    for (const p of stroke.points) {
      minX = Math.min(minX, p.x - half);
      minY = Math.min(minY, p.y - half);
      maxX = Math.max(maxX, p.x + half);
      maxY = Math.max(maxY, p.y + half);
    }
  }
  const rawWidth = maxX - minX + 2 * PADDING_PX;
  const rawHeight = maxY - minY + 2 * PADDING_PX;
  const scale = Math.min(1, maxSide / Math.max(rawWidth, rawHeight));
  return {
    width: Math.max(1, Math.ceil(rawWidth * scale)),
    height: Math.max(1, Math.ceil(rawHeight * scale)),
    strokes: strokes.map((s) => ({
      lineWidth: Math.max(1, s.lineWidth * scale),
      points: s.points.map((p) => ({ x: (p.x - minX + PADDING_PX) * scale, y: (p.y - minY + PADDING_PX) * scale })),
    })),
  };
}

/** Dark strokes on white, PNG base64 without the data URL prefix; null when canvas 2D is not available. */
export function renderRasterToPngBase64(raster: InkRaster): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return null;
  canvas.width = raster.width;
  canvas.height = raster.height;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, raster.width, raster.height);
  ctx.strokeStyle = '#111111';
  ctx.fillStyle = '#111111';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of raster.strokes) {
    const [first, ...rest] = stroke.points;
    if (!first) continue;
    ctx.lineWidth = stroke.lineWidth;
    if (rest.length === 0) {
      ctx.beginPath();
      ctx.arc(first.x, first.y, stroke.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const p of rest) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  let url: string;
  try {
    url = canvas.toDataURL('image/png');
  } catch {
    return null;
  }
  // Release the backing store early (iPad memory, C19).
  canvas.width = 0;
  canvas.height = 0;
  return url.startsWith(PNG_PREFIX) ? url.slice(PNG_PREFIX.length) : null;
}

function base64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

export type HandwritingOutcome =
  | { kind: 'ok'; text: string }
  | { kind: 'no_ink' }
  | { kind: 'image_error' }
  | { kind: 'not_read' }
  | { kind: 'message'; message: string };

export interface RecognizeInput {
  childId: Id;
  exerciseId: Id;
  questionId: string;
  exerciseCreatedAt: number;
  documentId: Id | null;
  documentHash: string | null;
  signal?: AbortSignal;
  /** Test seam; defaults to the canvas renderer. */
  render?: (raster: InkRaster) => string | null;
}

/** Rasterizes the answer ink and asks the online recognizer; the child confirms the text afterwards. */
export async function recognizeAnswerInk(input: RecognizeInput): Promise<HandwritingOutcome> {
  const ink = await loadAnswerInk(input.childId, input.exerciseId, input.questionId, input.exerciseCreatedAt);
  const render = input.render ?? renderRasterToPngBase64;

  let png: string | null = null;
  for (const maxSide of [MAX_SIDE_PX, MAX_SIDE_PX / 2, MAX_SIDE_PX / 4]) {
    const raster = planInkRaster(ink, maxSide);
    if (!raster) return { kind: 'no_ink' };
    const candidate = render(raster);
    if (candidate === null) return { kind: 'image_error' };
    if (base64Bytes(candidate) <= LIMITS.handwritingImageMaxBytes) {
      png = candidate;
      break;
    }
  }
  if (png === null) return { kind: 'image_error' };

  const result = await requestAI(
    'recognize_handwriting',
    { childId: input.childId, documentId: input.documentId, documentHash: input.documentHash, imagePngBase64: png },
    { signal: input.signal },
  );
  if (result.status === 'ok') {
    const text = result.data.text.trim().slice(0, LIMITS.answerMaxChars);
    return text.length > 0 ? { kind: 'ok', text } : { kind: 'not_read' };
  }
  return { kind: 'message', message: kidMessage(result) };
}
