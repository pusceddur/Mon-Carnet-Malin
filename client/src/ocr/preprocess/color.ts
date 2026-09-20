// Color copy of a processed page (§19.1): the geometric steps of the grayscale preprocessing are replayed on the decoded
// page, channel by channel, so that the « page originale » keeps its colors with exactly the frame of the OCR image
// (rotation, perspective, crop, straightening): ink drawn on the original view stays in place.
import { cropGray, resizeGray, rotateArbitrary, rotateQuarter } from './geometry';
import type { GrayImage, RgbaImage } from './image';
import { warpNormalized, type FrameStep } from './pipeline';

/** Long side of the color copy (display only: the OCR image keeps its own resolution). */
export const COLOR_MAX_SIDE = 2000;
export const COLOR_JPEG_QUALITY = 0.85;

type Channels = [GrayImage, GrayImage, GrayImage];

/** R, G, B planes; transparent pixels are composited over white (like the grayscale conversion). */
function split(img: RgbaImage): Channels {
  const size = img.width * img.height;
  const planes = [new Uint8ClampedArray(size), new Uint8ClampedArray(size), new Uint8ClampedArray(size)];
  const src = img.data;
  for (let i = 0, j = 0; j < size; i += 4, j++) {
    const alpha = src[i + 3]! / 255;
    const paper = 255 * (1 - alpha);
    planes[0]![j] = src[i]! * alpha + paper;
    planes[1]![j] = src[i + 1]! * alpha + paper;
    planes[2]![j] = src[i + 2]! * alpha + paper;
  }
  return planes.map((data) => ({ data, width: img.width, height: img.height })) as Channels;
}

function merge([r, g, b]: Channels): RgbaImage {
  const size = r.width * r.height;
  const data = new Uint8ClampedArray(size * 4);
  for (let i = 0, j = 0; j < size; i += 4, j++) {
    data[i] = r.data[j]!;
    data[i + 1] = g.data[j]!;
    data[i + 2] = b.data[j]!;
    data[i + 3] = 255;
  }
  return { data, width: r.width, height: r.height };
}

function fit(channels: Channels, maxSide: number): Channels {
  const { width, height } = channels[0];
  const long = Math.max(width, height);
  if (long <= maxSide) return channels;
  const s = maxSide / long;
  return channels.map((c) => resizeGray(c, width * s, height * s)) as Channels;
}

function applyStep(img: GrayImage, step: FrameStep, maxSide: number): GrayImage {
  switch (step.op) {
    case 'quarter':
      return rotateQuarter(img, step.turn);
    case 'warp':
      return warpNormalized(img, step.quad, maxSide);
    case 'crop':
      return cropGray(img, { x: step.x * img.width, y: step.y * img.height, width: step.width * img.width, height: step.height * img.height });
    case 'rotate':
      return rotateArbitrary(img, step.degrees, { expand: true, background: 255 });
  }
}

/** The page in color with the frame of the OCR image, long side at most `maxSide`. */
export function applyFrame(input: RgbaImage, frame: readonly FrameStep[], maxSide = COLOR_MAX_SIDE): RgbaImage {
  // Downscale first: every step then works on the display resolution only.
  let channels = fit(split(input), maxSide);
  for (const step of frame) channels = channels.map((c) => applyStep(c, step, maxSide)) as Channels;
  return merge(fit(channels, maxSide));
}
