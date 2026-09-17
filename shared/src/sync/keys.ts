// Stable keys of syncable entities (§15.2).
import type { SyncEntity, SyncTable } from '../types/api';
import type { PageContent, ReadingProgress } from '../types/domain';

/** Stable key of a syncable entity: pages `${documentId}:${pageIndex}`, progress `${childId}:${documentId}`, otherwise `id`. */
export function syncEntityKey<T extends SyncTable>(table: T, e: SyncEntity<T>): string {
  const entity: SyncEntity<SyncTable> = e;
  if (table === 'pages') {
    const page = entity as PageContent;
    return `${page.documentId}:${page.pageIndex}`;
  }
  if (table === 'progress') {
    const progress = entity as ReadingProgress;
    return `${progress.childId}:${progress.documentId}`;
  }
  return (entity as Exclude<SyncEntity<SyncTable>, PageContent | ReadingProgress>).id;
}
