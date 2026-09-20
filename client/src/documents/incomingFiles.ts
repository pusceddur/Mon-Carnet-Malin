// §29 Documents another app opened in Carnet Malin (« Ouvrir dans… »).
//
// iOS can hand a file over at any moment, including while the app is starting and before the import page exists. The
// files wait here until that page takes them, so none is lost between the two.
export interface IncomingDocument {
  file: File;
  /** Address of the copy iOS left behind; the import page gives it back once the document is stored. */
  url: string;
}

/** Nothing sensible can arrive in numbers: a parent opens one book at a time, and this only guards against a loop. */
const MAX_WAITING = 20;

let waiting: IncomingDocument[] = [];
const listeners = new Set<() => void>();

/** Adds a document and wakes whoever is watching. */
export function pushIncomingDocument(incoming: IncomingDocument): void {
  if (waiting.length >= MAX_WAITING) return;
  waiting = [...waiting, incoming];
  for (const listener of listeners) listener();
}

/** Takes every waiting document and empties the queue. */
export function takeIncomingDocuments(): IncomingDocument[] {
  const taken = waiting;
  waiting = [];
  return taken;
}

export function hasIncomingDocuments(): boolean {
  return waiting.length > 0;
}

/** Calls `listener` whenever a document arrives. Returns a function that stops watching. */
export function onIncomingDocuments(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests. */
export function resetIncomingDocuments(): void {
  waiting = [];
  listeners.clear();
}
