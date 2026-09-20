// §29 « Ouvrir dans Carnet Malin »: a PDF, an EPUB or a photo handed over by Mail, Safari, Fichiers or iCloud Drive.
// iOS opens the app with the address of a file (the official App plugin reports it); this reads the bytes and then
// removes the copy iOS left in the Inbox, so the same book is never imported twice.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNativeApp, isNativePluginAvailable } from '../nativeApp';

export const FILE_IMPORT_PLUGIN = 'FileImport';

export interface IncomingFile {
  file: File;
  /** Address of the file on the device; give it back to `discardIncomingFile` once the document is stored. */
  url: string;
}

/** The address of the opened file comes from the built-in App plugin of the native runtime (no extra dependency). */
interface AppPlugin {
  addListener(event: 'appUrlOpen', listener: (event: { url: string }) => void): Promise<PluginListenerHandle>;
}

interface FileImportPlugin {
  read(options: { url: string }): Promise<{ base64: string; name: string; mediaType: string; size: number }>;
  discard(options: { url: string }): Promise<{ removed: boolean }>;
}

let plugin: FileImportPlugin | null = null;
let appPlugin: AppPlugin | null = null;

function nativePlugin(): FileImportPlugin | null {
  if (!isNativePluginAvailable(FILE_IMPORT_PLUGIN)) return null;
  plugin ??= registerPlugin<FileImportPlugin>(FILE_IMPORT_PLUGIN);
  return plugin;
}

function appEvents(): AppPlugin {
  appPlugin ??= registerPlugin<AppPlugin>('App');
  return appPlugin;
}

function toFile(base64: string, name: string, mediaType: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mediaType });
}

/** Reads a file iOS handed over, or null when it cannot be read (too large, gone, not a file address). */
export async function readIncomingFile(url: string): Promise<IncomingFile | null> {
  const native = nativePlugin();
  if (!native) return null;
  try {
    const { base64, name, mediaType } = await native.read({ url });
    return { file: toFile(base64, name, mediaType), url };
  } catch {
    return null;
  }
}

/** Removes the copy iOS put in the Inbox. Call it once the document is safely stored. Never throws. */
export async function discardIncomingFile(url: string): Promise<void> {
  const native = nativePlugin();
  if (!native) return;
  try {
    await native.discard({ url });
  } catch {
    // The copy stays in the Inbox; iOS clears it eventually and a second import would only be a duplicate.
  }
}

/**
 * Calls `onFile` every time another app opens a document in Carnet Malin. Returns a function that stops listening,
 * and does nothing at all outside the native app.
 */
export function onIncomingFile(onFile: (incoming: IncomingFile) => void): () => void {
  if (!isNativeApp() || nativePlugin() === null) return () => undefined;
  let handle: PluginListenerHandle | null = null;
  let stopped = false;

  void appEvents().addListener('appUrlOpen', (event) => {
    if (!event.url.startsWith('file://')) return;
    void readIncomingFile(event.url).then((incoming) => {
      if (incoming) onFile(incoming);
    });
  }).then((listener) => {
    if (stopped) void listener.remove();
    else handle = listener;
  });

  return () => {
    stopped = true;
    void handle?.remove();
    handle = null;
  };
}
