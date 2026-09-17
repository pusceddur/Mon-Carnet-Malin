// Export of an answer box drawing as SVG / PNG (optional handwriting recognition, C3: the PNG is sent only when the parent enabled it).
import type { Id, InkAnnotation } from '@aide/shared';
import { fromAnswerSpace } from './anchoring';
import { getAnswerInk } from './AnnotationStore';
import { strokePath } from './DrawingEngine';
import { ANSWER_BOX_RATIO } from './Tools';

/** Standalone SVG document of answer strokes on a white background, `widthPx` wide. */
export function answerInkToSvg(strokes: readonly InkAnnotation[], widthPx: number): string {
  const height = Math.round(widthPx * ANSWER_BOX_RATIO);
  const paths = strokes
    .filter((a) => a.space.kind === 'answer' && a.deletedAt === null)
    .map((a) => {
      const { points, widthPx: strokeWidth } = fromAnswerSpace(a.points, a.width, widthPx);
      const d = strokePath(points, a.tool, strokeWidth);
      return d ? `<path d="${d}" fill="${a.color}" opacity="${a.opacity}"/>` : '';
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${height}" viewBox="0 0 ${widthPx} ${height}"><rect width="100%" height="100%" fill="#ffffff"/>${paths}</svg>`;
}

/**
 * PNG (base64, without the data: prefix) of the drawing of an answer box, or null when there is nothing to export or the
 * browser cannot rasterise (no canvas / image decoding).
 */
export async function answerInkToPngBase64(exerciseId: Id, questionId: string, childId: Id, widthPx = 800): Promise<string | null> {
  const strokes = await getAnswerInk(exerciseId, questionId, childId);
  if (strokes.length === 0 || typeof document === 'undefined' || typeof Image === 'undefined') return null;
  const svg = answerInkToSvg(strokes, widthPx);
  const height = Math.round(widthPx * ANSWER_BOX_RATIO);
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('image'));
    });
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, widthPx, height);
    const dataUrl = canvas.toDataURL('image/png');
    canvas.width = 0;
    canvas.height = 0;
    const comma = dataUrl.indexOf(',');
    return comma === -1 ? null : dataUrl.slice(comma + 1);
  } catch {
    return null;
  }
}
