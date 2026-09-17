import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiCacheKey, profileSignature, type AICacheKeyParts } from '../../src/hash/cacheKey';
import { sha256Hex, sha256HexSync } from '../../src/hash/sha256';
import { newId } from '../../src/id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sha256', () => {
  it('matches the standard test vectors (pure JS and native)', async () => {
    const vectors: [string, string][] = [
      ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
      ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ];
    for (const [input, hash] of vectors) {
      expect(sha256HexSync(input)).toBe(hash);
      expect(await sha256Hex(input)).toBe(hash);
    }
  });

  it('matches the native implementation around block boundaries and for UTF-8 text', async () => {
    for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
      const text = 'é'.repeat(Math.floor(length / 2)) + 'a'.repeat(length % 2);
      expect(sha256HexSync(text)).toBe(await sha256Hex(text));
    }
    expect(sha256HexSync('photosynthèse « œuf » 🦊')).toBe(await sha256Hex('photosynthèse « œuf » 🦊'));
  });

  it('hashes a million bytes with the pure JS fallback', () => {
    expect(sha256HexSync('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('accepts Uint8Array and ArrayBuffer input without mutating it', async () => {
    const bytes = new TextEncoder().encode('abc');
    const copy = bytes.slice();
    expect(await sha256Hex(bytes)).toBe(await sha256Hex('abc'));
    expect(await sha256Hex(bytes.buffer)).toBe(await sha256Hex('abc'));
    expect(sha256HexSync(bytes.subarray(1))).toBe(sha256HexSync('bc'));
    expect(bytes).toEqual(copy);
  });

  it('falls back to pure JS when crypto.subtle is missing', async () => {
    vi.stubGlobal('crypto', {});
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    vi.stubGlobal('crypto', undefined);
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('newId', () => {
  it('returns unique UUID v4 values', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it('uses getRandomValues when randomUUID is missing', () => {
    const getRandomValues = vi.fn((array: Uint8Array) => array.fill(0xff));
    vi.stubGlobal('crypto', { getRandomValues });
    const id = newId();
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(id).toMatch(UUID_V4);
    expect(id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('falls back to Math.random without crypto', () => {
    vi.stubGlobal('crypto', undefined);
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});

describe('cache keys', () => {
  const parts: AICacheKeyParts = {
    documentHash: 'a'.repeat(64), scope: 'p3', operation: 'explain_word', inputHash: 'b'.repeat(64),
    profileSignature: '10|intermediaire|simple', promptVersion: '2026-09-16.1', model: 'light',
  };

  it('profileSignature follows "age|level|difficulty"', () => {
    expect(profileSignature({ age: 10, readingLevel: 'intermediaire', explanationDifficulty: 'simple' })).toBe('10|intermediaire|simple');
  });

  it('aiCacheKey is a stable sha256 hex that depends on every part', async () => {
    const key = await aiCacheKey(parts);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await aiCacheKey({ ...parts })).toBe(key);
    const variants: Partial<AICacheKeyParts>[] = [
      { documentHash: null }, { scope: 'p4' }, { operation: 'explain_text' }, { inputHash: 'c'.repeat(64) },
      { profileSignature: '9|debutant|tres_simple' }, { promptVersion: 'x' }, { model: 'complex' },
    ];
    for (const v of variants) expect(await aiCacheKey({ ...parts, ...v })).not.toBe(key);
  });

  it('aiCacheKey ignores the property order and extra properties', async () => {
    const reordered = { model: parts.model, scope: parts.scope, documentHash: parts.documentHash, inputHash: parts.inputHash,
      operation: parts.operation, promptVersion: parts.promptVersion, profileSignature: parts.profileSignature } satisfies AICacheKeyParts;
    expect(await aiCacheKey(reordered)).toBe(await aiCacheKey(parts));
    expect(await aiCacheKey({ ...parts, extra: 'ignored' } as AICacheKeyParts)).toBe(await aiCacheKey(parts));
  });

  it('does not confuse separators inside values', async () => {
    const a = await aiCacheKey({ ...parts, scope: 'p1', inputHash: 'x' });
    const b = await aiCacheKey({ ...parts, scope: 'p1","x', inputHash: '' });
    expect(a).not.toBe(b);
  });
});
