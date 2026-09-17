/** Minimal image headers for magic-byte tests (headers only, not decodable images). */
export const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? Array.from(p, (c) => c.charCodeAt(0)) : p)));
export const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
export const be16 = (n: number): number[] => [(n >>> 8) & 255, n & 255];
export const le16 = (n: number): number[] => [n & 255, (n >>> 8) & 255];
export const le24 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
export const le32 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

export function pngHeader(width: number, height: number): Uint8Array {
  return bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(width), be32(height), [8, 0, 0, 0, 0], [0, 0, 0, 0]);
}

export function jpegHeader(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, ...be16(16), ...Array.from('JFIF\0', (c) => c.charCodeAt(0)), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const dqt = [0xff, 0xdb, ...be16(4), 0, 0];
  const sof = [0xff, 0xc0, ...be16(17), 8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return bytes([0xff, 0xd8], app0, dqt, sof, [0xff, 0xda]);
}
