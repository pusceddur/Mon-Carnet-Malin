import { alignSpokenText, type DocumentMeta, type Id, type PageContent } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router';
import { prepareReading, setDocumentTextMode } from '../../api/documents';
import { ApiError } from '../../api/http';
import { relaunchTranscription } from '../../api/worker';
import { db } from '../../db/localDb';
import { Button, EmptyState, ProgressBar, Segmented, Spinner, useToast } from '../../design/components';
import { documentTextMode, getPages, toQueueJob, usePageImageUrl } from '../../documents/DocumentCache';
import { isDoubtfulPage } from '../../documents/DocumentParser';
import { useDocumentProgress, usePagesReadByAi } from '../../documents/ProcessingQueue';
import { jobErrorMessage, pageStatusLabel } from '../../documents/ui/labels';
import '../../documents/ui/parentDocuments.css';
import { format } from '../../i18n/fr';
import { documents } from '../../i18n/fr/documents';
import { useOnlineStatus } from '../../platform/online';
import { describeError, reportSessionError } from '../../state/errors';
import { ParentPage } from './ParentPage';

const t = documents.detail;
const tm = documents.textMode;

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

/** §22 at least one block of the page is read from a preparation that still has its words. */
export function isPagePreparedForVoice(page: PageContent): boolean {
  return page.blocks.some((b) => b.spoken !== undefined && alignSpokenText(b.text, b.spoken) !== null);
}

/** §22 « Préparer la lecture à voix haute » of the whole document (the reader does it page by page). */
function ReadingPreparationSection({ documentId, pages }: { documentId: Id; pages: readonly PageContent[] }): JSX.Element | null {
  const toast = useToast();
  const online = useOnlineStatus();
  const [running, setRunning] = useState(false);
  const readable = pages.filter((p) => (p.status === 'ready' || p.status === 'low_confidence') && p.blocks.length > 0);
  if (readable.length === 0) return null;
  const prepared = readable.filter(isPagePreparedForVoice).length;
  const all = prepared === readable.length;

  const run = async (): Promise<void> => {
    setRunning(true);
    try {
      const { queued, unavailable } = await prepareReading(documentId, all ? { force: true } : {});
      if (unavailable !== null) toast.warning(t.prepareUnavailable[unavailable]);
      else if (queued === 0) toast.info(t.prepareNone);
      else toast.success(queued === 1 ? t.prepareOne : format(t.prepareMany, { count: queued }));
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="stack">
      <p className="docs-muted">{t.prepareHint}</p>
      <p className="docs-muted">{format(t.prepareCount, { prepared, total: readable.length })}</p>
      <div className="parent-actions">
        <Button size="parent" variant="secondary" icon="🗣️" loading={running} disabled={!online} onClick={() => void run()}>
          {all ? t.prepareAgain : t.prepare}
        </Button>
      </div>
      {!online && <p className="docs-muted">{t.prepareOffline}</p>}
    </div>
  );
}

/**
 * §17.10 document type: « Texte écrit par un enfant » keeps the child's words and restores the punctuation. Changing it saves
 * the type on the server and sends the page images to the « lecture intelligente » again.
 */
function TextModeSection({ doc }: { doc: DocumentMeta }): JSX.Element {
  const toast = useToast();
  const online = useOnlineStatus();
  const readByAi = usePagesReadByAi();
  const [saving, setSaving] = useState(false);
  const mode = documentTextMode(doc);
  const next = mode === 'punctuated' ? 'faithful' : 'punctuated';

  const change = async (): Promise<void> => {
    setSaving(true);
    try {
      const { document, queued } = await setDocumentTextMode(doc.id, next);
      // Local copy only (the server has the new type, a sync push never changes it).
      await db.documents.update(doc.id, { textMode: document.textMode });
      toast.success(queued === 0 ? tm.saved : queued === 1 ? t.relaunchAiOne : format(t.relaunchAiMany, { count: queued }));
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="docs-text-mode">
      <p className="docs-lead">{format(tm.current, { mode: mode === 'punctuated' ? tm.punctuated : tm.faithful })}</p>
      <p className="docs-muted">{mode === 'punctuated' ? tm.punctuatedHint : tm.faithfulHint}</p>
      {mode === 'punctuated' && !readByAi && <p className="docs-warning">{tm.needsAi}</p>}
      <div className="parent-actions">
        <Button size="parent" variant="secondary" icon={next === 'punctuated' ? '✍️' : '📖'} loading={saving} disabled={!online} onClick={() => void change()}>
          {next === 'punctuated' ? tm.switchToPunctuated : tm.switchToFaithful}
        </Button>
      </div>
      {online ? <p className="docs-muted">{tm.manualKept}</p> : <p className="docs-muted">{tm.offline}</p>}
    </div>
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
      {doc.kind !== 'epub' && <TextModeSection doc={doc} />}
      {doc.kind !== 'epub' && <RelaunchAiButton documentId={documentId} />}
      <ReadingPreparationSection documentId={documentId} pages={pages} />
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
