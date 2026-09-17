import type { Id, PageContent } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError } from '../../api/http';
import { relaunchTranscription } from '../../api/worker';
import { db } from '../../db/localDb';
import { Button, EmptyState, ProgressBar, Segmented, Spinner, useToast } from '../../design/components';
import { getPages, toQueueJob, usePageImageUrl } from '../../documents/DocumentCache';
import { isDoubtfulPage } from '../../documents/DocumentParser';
import { useDocumentProgress } from '../../documents/ProcessingQueue';
import { jobErrorMessage, pageStatusLabel } from '../../documents/ui/labels';
import '../../documents/ui/parentDocuments.css';
import { format } from '../../i18n/fr';
import { documents } from '../../i18n/fr/documents';
import { useOnlineStatus } from '../../platform/online';
import { describeError, reportSessionError } from '../../state/errors';
import { ParentPage } from './ParentPage';

const t = documents.detail;

type Filter = 'all' | 'doubtful';

function PageCard({ documentId, page, processingPageIndex, jobError }: { documentId: Id; page: PageContent; processingPageIndex: number | null; jobError: string | null }): JSX.Element {
  const navigate = useNavigate();
  const thumb = usePageImageUrl(documentId, page.pageIndex, 'thumb');
  const number = page.pageIndex + 1;
  const status = pageStatusLabel(page, processingPageIndex);
  // Warnings already told by the status label are not repeated.
  const warnings = page.warnings.filter((w) => (w !== 'low_confidence' || page.status !== 'low_confidence') && (w !== 'awaiting_ai' || page.status !== 'failed'));
  return (
    <li>
      <button
        type="button"
        className={`docs-page-card docs-page-card--${status.tone}`}
        aria-label={format(t.openPage, { number })}
        onClick={() => navigate(`/parent/documents/${encodeURIComponent(documentId)}/pages/${page.pageIndex}`)}
      >
        <span className="docs-page-card__thumb">
          {thumb ? <img src={thumb} alt="" /> : <span className="docs-muted">{t.noThumbnail}</span>}
        </span>
        <span className="docs-page-card__title">{format(t.page, { number })}</span>
        <span className="docs-page-card__status">
          <span aria-hidden="true">{status.emoji} </span>
          {status.label}
        </span>
        {page.confidence !== null && <span className="docs-page-card__meta">{format(t.reliability, { value: page.confidence })}</span>}
        {page.textSource && <span className="docs-page-card__meta">{documents.textSource[page.textSource]}</span>}
        {warnings.length > 0 && (
          <span className="docs-chips">
            {warnings.map((w) => (
              <span key={w} className="tag">
                {documents.warnings[w]}
              </span>
            ))}
          </span>
        )}
        {page.status === 'failed' && jobError && <span className="docs-page-card__error">{jobError}</span>}
      </button>
    </li>
  );
}

/** « Relancer la lecture intelligente »: sends the page images stored on the server to the home computer again (§17.5). */
function RelaunchAiButton({ documentId }: { documentId: Id }): JSX.Element {
  const toast = useToast();
  const online = useOnlineStatus();
  const [running, setRunning] = useState(false);

  const relaunch = async (): Promise<void> => {
    setRunning(true);
    try {
      const { queued } = await relaunchTranscription(documentId);
      if (queued === 0) toast.info(t.relaunchAiNone);
      else toast.success(queued === 1 ? t.relaunchAiOne : format(t.relaunchAiMany, { count: queued }));
    } catch (error) {
      await reportSessionError(error);
      // 404 without a specific code: the server has no home computer configured (worker routes disabled).
      const notConfigured = error instanceof ApiError && error.status === 404 && (error.code === 'not_found' || error.code === 'http_error');
      toast.error(notConfigured ? t.relaunchAiUnavailable : describeError(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="parent-actions">
        <Button size="parent" variant="secondary" icon="✨" loading={running} disabled={!online} onClick={() => void relaunch()}>
          {t.relaunchAi}
        </Button>
      </div>
      {!online && <p className="docs-muted">{t.relaunchAiOffline}</p>}
    </>
  );
}

/** Pages of a document with status, reliability and warnings; filter on pages to check. */
export default function DocumentDetailPage(): JSX.Element {
  const { documentId = '' } = useParams();
  const navigate = useNavigate();
  const doc = useLiveQuery(async () => (await db.documents.get(documentId)) ?? false, [documentId], null);
  const pages = useLiveQuery(() => getPages(documentId), [documentId], null);
  const jobErrors = useLiveQuery(
    async () => new Map((await db.jobs.where('documentId').equals(documentId).toArray()).map((j) => [j.pageIndex, toQueueJob(j).error])),
    [documentId],
    new Map<number, string | null>(),
  );
  const progress = useDocumentProgress(documentId);
  const [filter, setFilter] = useState<Filter>('all');
  const back = (
    <Button variant="ghost" size="parent" icon="⬅️" onClick={() => navigate('/parent/documents')}>
      {t.back}
    </Button>
  );

  if (doc === null || pages === null) {
    return (
      <ParentPage title={documents.admin.title}>
        <Spinner />
      </ParentPage>
    );
  }
  if (doc === false || doc.deletedAt !== null) {
    return (
      <ParentPage title={documents.admin.title} actions={back}>
        <EmptyState emoji="🔎" title={t.notFound} />
      </ParentPage>
    );
  }

  const doubtful = pages.filter(isDoubtfulPage);
  const shown = filter === 'doubtful' ? doubtful : pages;
  const ready = pages.filter((p) => p.status === 'ready').length;
  const processingPageIndex = progress?.processingPageIndex ?? null;

  return (
    <ParentPage title={doc.title} intro={format(t.summary, { ready, toCheck: doubtful.length, total: pages.length })} actions={back}>
      {doc.status === 'processing' && progress && (
        <ProgressBar value={progress.percent} label={documents.admin.progress} valueText={format(documents.admin.progressValue, { done: progress.ready + progress.lowConfidence + progress.failed, total: progress.total })} />
      )}
      {/* EPUB pages come from the book text: nothing to read from an image. */}
      {doc.kind !== 'epub' && <RelaunchAiButton documentId={documentId} />}
      <Segmented<Filter>
        size="parent"
        label={t.filterLabel}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t.filterAll },
          { value: 'doubtful', label: format(t.filterDoubtful, { count: doubtful.length }) },
        ]}
      />
      {shown.length === 0 ? (
        <EmptyState emoji="✅" title={t.emptyDoubtful} headingLevel={3} />
      ) : (
        <ul className="docs-page-grid">
          {shown.map((page) => (
            <PageCard
              key={page.pageIndex}
              documentId={documentId}
              page={page}
              processingPageIndex={processingPageIndex}
              jobError={jobErrorMessage(jobErrors.get(page.pageIndex))}
            />
          ))}
        </ul>
      )}
    </ParentPage>
  );
}
