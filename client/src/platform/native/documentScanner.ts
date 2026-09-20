// §29 Scanner de pages: the document camera of iPadOS (edge detection, perspective correction, several pages in a row).
// Only inside the App Store app; everywhere else the import page keeps its own camera and photo picker.
import { registerPlugin } from '@capacitor/core';
import { isNativePluginAvailable } from '../nativeApp';

export const DOCUMENT_SCANNER_PLUGIN = 'DocumentScanner';

export interface ScannedPage {
  /** JPEG bytes, base64 encoded. */
  base64: string;
  mediaType: 'image/jpeg';
  width: number;
  height: number;
}

export interface ScanOptions {
  /** JPEG quality 0..1 (default 0.85). */
  quality?: number;
  /** Longest side in pixels (default 2480, the width the OCR works at). */
  maxSide?: number;
}

interface DocumentScannerPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  scan(options: ScanOptions): Promise<{ cancelled: boolean; pages: ScannedPage[] }>;
}

let plugin: DocumentScannerPlugin | null = null;

function nativePlugin(): DocumentScannerPlugin | null {
  if (!isNativePluginAvailable(DOCUMENT_SCANNER_PLUGIN)) return null;
  plugin ??= registerPlugin<DocumentScannerPlugin>(DOCUMENT_SCANNER_PLUGIN);
  return plugin;
}

/** True when the page scanner can be offered (App Store app on a device with a camera). */
export async function isScannerAvailable(): Promise<boolean> {
  const native = nativePlugin();
  if (!native) return false;
  try {
    return (await native.isAvailable()).available;
  } catch {
    return false;
  }
}

/** Blob of a scanned page, ready for the import queue. */
export function scannedPageToBlob(page: ScannedPage): Blob {
  const binary = atob(page.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: page.mediaType });
}

/**
 * Opens the document camera. Returns the scanned pages in order, or an empty list when the parent closed the camera
 * (a cancellation is not a failure). Returns null when the scanner is not available at all.
 */
export async function scanPages(options: ScanOptions = {}): Promise<Blob[] | null> {
  const native = nativePlugin();
  if (!native) return null;
  const result = await native.scan(options);
  if (result.cancelled) return [];
  return result.pages.map(scannedPageToBlob);
}
