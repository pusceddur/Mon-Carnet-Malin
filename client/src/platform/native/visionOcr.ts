// §29 On-device text recognition (Vision) as an OcrEngine, so that the reading pipeline does not change at all.
// Inside the App Store app this replaces the WebAssembly engine: better on French, no 44 MB of models to carry, and the
// work happens outside the web view instead of on its main thread.
import { registerPlugin } from '@capacitor/core';
import type { OcrEngine } from '../../ocr/BrowserOCR';
import type { OcrLine, OcrResult, OcrWord } from '../../ocr/ocrLines';
import { isNativePluginAvailable } from '../nativeApp';

export const TEXT_RECOGNIZER_PLUGIN = 'TextRecognizer';

/** The books are French; the system falls back on its own when a line is not. */
const LANGUAGES = ['fr-FR'];

interface NativeWord {
  text: string;
  confidence: number;
  left?: number;
  right?: number;
}

interface NativeLine {
  text: string;
  top: number;
  left: number;
  height: number;
  confidence: number;
  words: NativeWord[];
}

interface TextRecognizerPlugin {
  isAvailable(): Promise<{ available: boolean; languages: string[] }>;
  recognize(options: { base64: string; languages?: string[]; fast?: boolean }): Promise<{
    lines: NativeLine[];
    confidence: number;
    engine: string;
    width: number;
    height: number;
  }>;
}

let plugin: TextRecognizerPlugin | null = null;

function nativePlugin(): TextRecognizerPlugin | null {
  if (!isNativePluginAvailable(TEXT_RECOGNIZER_PLUGIN)) return null;
  plugin ??= registerPlugin<TextRecognizerPlugin>(TEXT_RECOGNIZER_PLUGIN);
  return plugin;
}

/** True when the system recognizer is there and knows French. */
export async function isVisionOcrAvailable(): Promise<boolean> {
  const native = nativePlugin();
  if (!native) return false;
  try {
    const { available, languages } = await native.isAvailable();
    return available && languages.some((code) => code.toLowerCase().startsWith('fr'));
  } catch {
    return false;
  }
}

/** base64 of an encoded image, without the `data:` prefix. */
export async function toBase64(image: Uint8Array | Blob): Promise<string> {
  const bytes = image instanceof Blob ? new Uint8Array(await image.arrayBuffer()) : image;
  let binary = '';
  // Chunked so that a page-sized image never overflows the argument list of String.fromCharCode.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function toOcrLine(line: NativeLine): OcrLine {
  const words: OcrWord[] = line.words.map((word) => ({
    text: word.text,
    confidence: word.confidence,
    ...(word.left === undefined ? {} : { left: word.left }),
    ...(word.right === undefined ? {} : { right: word.right }),
  }));
  return { text: line.text, top: line.top, left: line.left, height: line.height, words };
}

/**
 * The system recognizer behind the interface the reading pipeline already uses. `notePageDone` and `terminate` have
 * nothing to do: there is no worker to recycle, the system owns the model.
 */
export function createVisionOcrEngine(): OcrEngine | null {
  const native = nativePlugin();
  if (!native) return null;
  return {
    async recognize(image: Uint8Array | Blob): Promise<OcrResult> {
      const result = await native.recognize({ base64: await toBase64(image), languages: LANGUAGES });
      return { lines: result.lines.map(toOcrLine), confidence: result.confidence };
    },
    notePageDone(): void {
      // Nothing to recycle.
    },
    terminate(): Promise<void> {
      return Promise.resolve();
    },
  };
}
