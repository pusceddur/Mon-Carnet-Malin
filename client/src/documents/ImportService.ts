// STUB: client-documents
import { newId, type Id } from '@aide/shared';

/** Creates DocumentMeta + 'pending' pages + jobs, then starts the processing queue. Returns the document id. */
export async function importFiles(files: File[], opts: { title: string; childIds: Id[] }): Promise<Id> {
  void files;
  void opts;
  return newId();
}
