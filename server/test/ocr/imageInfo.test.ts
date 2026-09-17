import { describe, expect, it } from 'vitest';
import { exceedsPixelBudget, OCR_IMAGE_MAX_PIXELS, sniffImage } from '../../src/ocr/imageInfo';
import { be16, bytes, jpegHeader, le16, le24, le32, pngHeader } from './helpers/images';

describe('sniffImage', () => {
  it('recognizes PNG and reads IHDR dimensions', () => {
    expect(sniffImage(pngHeader(2480, 3508))).toEqual({ mime: 'image/png', width: 2480, height: 3508 });
  });

  it('recognizes JPEG and reads the SOF dimensions after other segments', () => {
    expect(sniffImage(jpegHeader(1754, 2480))).toEqual({ mime: 'image/jpeg', width: 1754, height: 2480 });
  });

  it('accepts a JPEG whose size cannot be read', () => {
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe1], be16(2)))).toEqual({ mime: 'image/jpeg', width: null, height: null });
  });

  it('recognizes lossy, lossless and extended WebP', () => {
    const lossy = bytes('RIFF', le32(100), 'WEBP', 'VP8 ', le32(80), [0, 0, 0], [0x9d, 0x01, 0x2a], le16(1200), le16(1600));
    expect(sniffImage(lossy)).toEqual({ mime: 'image/webp', width: 1200, height: 1600 });

    const bits = (1200 - 1) | ((1600 - 1) << 14);
    const lossless = bytes('RIFF', le32(100), 'WEBP', 'VP8L', le32(80), [0x2f], le32(bits));
    expect(sniffImage(lossless)).toEqual({ mime: 'image/webp', width: 1200, height: 1600 });

    const extended = bytes('RIFF', le32(100), 'WEBP', 'VP8X', le32(10), [0, 0, 0, 0], le24(1199), le24(1599));
    expect(sniffImage(extended)).toEqual({ mime: 'image/webp', width: 1200, height: 1600 });
  });

  it.each([
    ['GIF', bytes('GIF89a', [1, 0, 1, 0])],
    ['PDF', bytes('%PDF-1.7\n')],
    ['HEIC', bytes([0, 0, 0, 0x18], 'ftypheic')],
    ['SVG', bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['RIFF that is not WebP', bytes('RIFF', le32(4), 'WAVE')],
    ['truncated PNG signature', bytes([0x89, 0x50, 0x4e])],
    ['empty', new Uint8Array(0)],
  ])('rejects %s', (_label, data) => {
    expect(sniffImage(data)).toBeNull();
  });
});

describe('exceedsPixelBudget', () => {
  it('accepts client pages and unknown sizes, refuses decompression bombs', () => {
    expect(exceedsPixelBudget({ mime: 'image/jpeg', width: 1754, height: 2480 })).toBe(false);
    expect(exceedsPixelBudget({ mime: 'image/jpeg', width: null, height: null })).toBe(false);
    expect(exceedsPixelBudget({ mime: 'image/png', width: 30_000, height: 30_000 })).toBe(true);
    expect(exceedsPixelBudget({ mime: 'image/png', width: 7_000, height: Math.ceil(OCR_IMAGE_MAX_PIXELS / 7_000) + 1 })).toBe(true);
    expect(exceedsPixelBudget({ mime: 'image/png', width: 0, height: 100 })).toBe(true);
  });
});
