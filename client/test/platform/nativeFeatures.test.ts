// §29 The bridges to the native iPadOS features. The Swift side cannot run here, so the tests pin what the web app
// relies on: the shape it sends, the shape it reads back, and that everything degrades to nothing off the native app.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const plugins = new Map<string, unknown>();
let available = true;

vi.mock('@capacitor/core', () => ({
  registerPlugin: (name: string) => plugins.get(name) ?? {},
}));

vi.mock('../../src/platform/nativeApp', () => ({
  isNativeApp: () => available,
  isNativePluginAvailable: (name: string) => available && plugins.has(name),
}));

beforeEach(() => {
  plugins.clear();
  available = true;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const jpegPage = { base64: btoa('page-bytes'), mediaType: 'image/jpeg' as const, width: 1200, height: 1600 };

describe('document scanner', () => {
  it('turns scanned pages into blobs and treats a cancellation as no pages', async () => {
    const scan = vi.fn().mockResolvedValue({ cancelled: false, pages: [jpegPage, jpegPage] });
    plugins.set('DocumentScanner', { isAvailable: () => Promise.resolve({ available: true }), scan });
    const { scanPages, isScannerAvailable } = await import('../../src/platform/native/documentScanner');

    expect(await isScannerAvailable()).toBe(true);
    const pages = await scanPages({ maxSide: 2480 });
    expect(pages).toHaveLength(2);
    expect(pages![0]!.type).toBe('image/jpeg');
    expect(pages![0]!.size).toBe('page-bytes'.length);
    expect(scan).toHaveBeenCalledWith({ maxSide: 2480 });

    scan.mockResolvedValue({ cancelled: true, pages: [] });
    expect(await scanPages()).toEqual([]);
  });

  it('is simply absent outside the native app', async () => {
    available = false;
    const { scanPages, isScannerAvailable } = await import('../../src/platform/native/documentScanner');
    expect(await isScannerAvailable()).toBe(false);
    expect(await scanPages()).toBeNull();
  });
});

describe('vision OCR', () => {
  const line = {
    text: 'Le chat dort',
    top: 120,
    left: 40,
    height: 30,
    confidence: 92.5,
    words: [
      { text: 'Le', confidence: 92.5, left: 40, right: 60 },
      { text: 'chat', confidence: 92.5, left: 65, right: 110 },
      // Vision could not place this one: it keeps its text and no position.
      { text: 'dort', confidence: 92.5 },
    ],
  };

  it('answers in the shape the reading pipeline already uses', async () => {
    const recognize = vi.fn().mockResolvedValue({ lines: [line], confidence: 92.5, engine: 'vision', width: 1200, height: 1600 });
    plugins.set('TextRecognizer', {
      isAvailable: () => Promise.resolve({ available: true, languages: ['fr-FR', 'en-US'] }),
      recognize,
    });
    const { createVisionOcrEngine, isVisionOcrAvailable } = await import('../../src/platform/native/visionOcr');

    expect(await isVisionOcrAvailable()).toBe(true);
    const engine = createVisionOcrEngine();
    const result = await engine!.recognize(new Uint8Array([1, 2, 3]));

    expect(result.confidence).toBe(92.5);
    expect(result.lines).toEqual([{
      text: 'Le chat dort',
      top: 120,
      left: 40,
      height: 30,
      words: [
        { text: 'Le', confidence: 92.5, left: 40, right: 60 },
        { text: 'chat', confidence: 92.5, left: 65, right: 110 },
        { text: 'dort', confidence: 92.5 },
      ],
    }]);
    // The engine owns no worker: these two only have to be harmless.
    engine!.notePageDone();
    await engine!.terminate();
    expect(recognize.mock.calls[0]![0].languages).toEqual(['fr-FR']);
  });

  it('is refused when the system does not know French', async () => {
    plugins.set('TextRecognizer', {
      isAvailable: () => Promise.resolve({ available: true, languages: ['en-US'] }),
      recognize: vi.fn(),
    });
    const { isVisionOcrAvailable } = await import('../../src/platform/native/visionOcr');
    expect(await isVisionOcrAvailable()).toBe(false);
  });

  it('encodes a page-sized image without overflowing the argument list', async () => {
    plugins.set('TextRecognizer', { isAvailable: vi.fn(), recognize: vi.fn() });
    const { toBase64 } = await import('../../src/platform/native/visionOcr');
    const big = new Uint8Array(200_000).fill(65);
    const encoded = await toBase64(big);
    expect(encoded).toBe(btoa('A'.repeat(200_000)));
  });

  it('gives no engine outside the native app', async () => {
    available = false;
    const { createVisionOcrEngine } = await import('../../src/platform/native/visionOcr');
    expect(createVisionOcrEngine()).toBeNull();
  });
});

describe('« Ouvrir dans Carnet Malin »', () => {
  it('reads the file iOS hands over and removes the copy from the Inbox', async () => {
    const url = 'file:///var/mobile/Containers/Data/Application/X/Documents/Inbox/livre.pdf';
    const read = vi.fn().mockResolvedValue({ base64: btoa('%PDF-1.7'), name: 'livre.pdf', mediaType: 'application/pdf', size: 8 });
    const discard = vi.fn().mockResolvedValue({ removed: true });
    plugins.set('FileImport', { read, discard });
    const { readIncomingFile, discardIncomingFile } = await import('../../src/platform/native/fileImport');

    const incoming = await readIncomingFile(url);
    expect(incoming!.file.name).toBe('livre.pdf');
    expect(incoming!.file.type).toBe('application/pdf');
    expect(await incoming!.file.text()).toBe('%PDF-1.7');

    await discardIncomingFile(url);
    expect(discard).toHaveBeenCalledWith({ url });
  });

  it('keeps quiet when the file cannot be read, and listens to nothing off the native app', async () => {
    plugins.set('FileImport', { read: vi.fn().mockRejectedValue(new Error('gone')), discard: vi.fn() });
    const { readIncomingFile } = await import('../../src/platform/native/fileImport');
    expect(await readIncomingFile('file:///gone.pdf')).toBeNull();

    available = false;
    vi.resetModules();
    const off = await import('../../src/platform/native/fileImport');
    const stop = off.onIncomingFile(() => expect.unreachable('no file outside the app'));
    expect(typeof stop).toBe('function');
    stop();
  });
});
