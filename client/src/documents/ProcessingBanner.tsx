import type { Id, PageStatus } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX } from 'react';
import { db } from '../db/localDb';
import { ProgressBar } from '../design/components';
import { format } from '../i18n/fr';
import { documents as t } from '../i18n/fr/documents';
import { useDocumentProgress } from './ProcessingQueue';
import './documents.css';

/** Number of leading pages that are no longer waiting (the child can read up to that page). */
export function leadingDonePages(statuses: readonly { pageIndex: number; status: PageStatus }[]): number {
  const sorted = [...statuses].sort((a, b) => a.pageIndex - b.pageIndex);
  let count = 0;
  for (const p of sorted) {
    if (p.status === 'pending' || p.status === 'processing') break;
    count++;
  }
  return count;
}

/** « Chapitre ████░░ 52 % · Page 13 disponible · Préparation des pages suivantes… » — hidden once every page is done. */
export function ProcessingBanner(props: { documentId: Id }): JSX.Element {
  const progress = useDocumentProgress(props.documentId);
  const statuses = useLiveQuery(
    async () => (await db.pages.where('documentId').equals(props.documentId).toArray()).map((p) => ({ pageIndex: p.pageIndex, status: p.status })),
    [props.documentId],
    [],
  );
  if (!progress || progress.total === 0) return <></>;
  const finished = progress.percent >= 100 && progress.processingPageIndex === null;
  if (finished) return <></>;
  const available = leadingDonePages(statuses);
  return (
    <section className="docs-banner" data-document-id={props.documentId}>
      <ProgressBar value={progress.percent} label={t.banner.label} tone="accent" />
      <p className="docs-banner__text" role="status" aria-live="polite">
        <span>{available > 0 ? format(t.banner.pageAvailable, { page: available }) : t.banner.firstPage}</span>
        {available > 0 && (
          <>
            <span className="docs-banner__dot" aria-hidden="true">
              ·
            </span>
            <span>{t.banner.nextPages}</span>
          </>
        )}
      </p>
    </section>
  );
}
