// Reads a prepared page with the OCR engine, region by region when the page has columns.
import type { OcrLine, OcrResult } from './ocrLines';
import { cropGray } from './preprocess/geometry';
import { encodePgm, type GrayImage, type Rect } from './preprocess/image';

export interface RecognizeEngine {
  recognize(image: Uint8Array): Promise<OcrResult>;
}

export async function recognizePage(engine: RecognizeEngine, image: GrayImage, regions: readonly Rect[]): Promise<OcrResult> {
  if (regions.length === 0) return engine.recognize(encodePgm(image));
  const lines: OcrLine[] = [];
  let weightedConfidence = 0;
  let weight = 0;
  for (const region of regions) {
    const result = await engine.recognize(encodePgm(cropGray(image, region)));
    const chars = result.lines.reduce((n, l) => n + l.text.length, 0);
    weightedConfidence += result.confidence * chars;
    weight += chars;
    for (const line of result.lines) lines.push({ ...line, top: line.top + region.y, left: line.left + region.x });
  }
  return { lines, confidence: weight > 0 ? weightedConfidence / weight : 0 };
}
