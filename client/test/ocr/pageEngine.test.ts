// §29 Choosing the engine that reads the pages: the system one inside the app, the WebAssembly one everywhere else.
import { describe, expect, it, vi } from 'vitest';
import type { OcrEngine } from '../../src/ocr/BrowserOCR';
import { createPageOcrEngine } from '../../src/ocr/pageEngine';

function fakeEngine(name: string, calls: string[]): OcrEngine {
  return {
    recognize: () => {
      calls.push(`${name}:recognize`);
      return Promise.resolve({ lines: [], confidence: 0 });
    },
    notePageDone: () => calls.push(`${name}:notePageDone`),
    terminate: () => {
      calls.push(`${name}:terminate`);
      return Promise.resolve();
    },
  };
}

describe('page OCR engine', () => {
  it('reads with the system recognizer when it is there, and chooses only once', async () => {
    const calls: string[] = [];
    const visionAvailable = vi.fn().mockResolvedValue(true);
    const engine = createPageOcrEngine({
      visionAvailable,
      createVision: () => fakeEngine('vision', calls),
      fallback: fakeEngine('wasm', calls),
    });

    await engine.recognize(new Uint8Array([1]));
    await engine.recognize(new Uint8Array([2]));
    expect(calls).toEqual(['vision:recognize', 'vision:recognize']);
    expect(visionAvailable).toHaveBeenCalledTimes(1);
  });

  it('falls back to the WebAssembly engine when the system has none', async () => {
    const calls: string[] = [];
    const engine = createPageOcrEngine({
      visionAvailable: () => Promise.resolve(false),
      createVision: () => null,
      fallback: fakeEngine('wasm', calls),
    });
    await engine.recognize(new Uint8Array([1]));
    engine.notePageDone();
    await Promise.resolve();
    expect(calls).toContain('wasm:recognize');
    expect(calls).toContain('wasm:notePageDone');
  });

  it('a system that cannot answer leaves the WebAssembly engine in place instead of failing the page', async () => {
    const calls: string[] = [];
    const engine = createPageOcrEngine({
      visionAvailable: () => Promise.reject(new Error('plugin gone')),
      createVision: () => fakeEngine('vision', calls),
      fallback: fakeEngine('wasm', calls),
    });
    await engine.recognize(new Uint8Array([1]));
    expect(calls).toEqual(['wasm:recognize']);
  });

  it('terminates nothing when no page was ever read', async () => {
    const calls: string[] = [];
    const engine = createPageOcrEngine({
      visionAvailable: () => Promise.resolve(false),
      createVision: () => null,
      fallback: fakeEngine('wasm', calls),
    });
    await engine.terminate();
    expect(calls).toEqual([]);
  });
});
