import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button, EmptyState, IconButton, OfflineBadge, PageHeader, Spinner, useToast } from '../../design/components';
import { db } from '../../db/localDb';
import { format } from '../../i18n/fr';
import { homework as h } from '../../i18n/fr/homework';
import { PencilToolbar, usePencilStore } from '../../pencil';
import { usePageContent } from '../../pencil/AnnotationStore';
import { PATHS, readerPath } from '../../state/guards';
import { useSelectedChild } from '../../state/session';
import { useDocumentTitle } from '../../state/useDocumentTitle';
import { OriginalPageView } from '../reader/OriginalPageView';
import { canShareFile, downloadFile, exportHomework, shareFile } from './exportHomework';
import { isHomeworkOfChild, setHomeworkDone } from './homework';
import './homework.css';

/**
 * A homework sheet (§19.3): the page in color, text boxes typed with a keyboard or Scribble (« Écrire du texte » on by
 * default), drawing with the Pencil, the text read aloud in the reader, « J'ai terminé », and a PDF to send or print.
 */
export default function HomeworkPage(): JSX.Element {
  const { documentId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const child = useSelectedChild();
  const doc = useLiveQuery(async () => (await db.documents.get(documentId)) ?? false, [documentId], null);
  const [pageIndex, setPageIndex] = useState(0);
  const page = usePageContent(documentId, pageIndex);
  const pencilMode = usePencilStore((s) => s.mode);
  const [preparing, setPreparing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  useDocumentTitle(doc ? doc.title : h.documentTitle);

  // Leaving the homework: back to reading mode, and a prepared file is dropped.
  useEffect(() => () => usePencilStore.getState().setMode('lecture'), []);
  useEffect(() => setFile(null), [documentId]);

  const back = (): void => void navigate(PATHS.homework);

  if (doc === null) {
    return (
      <div className="route-loading">
        <Spinner size="lg" />
      </div>
    );
  }
  if (doc === false || !child || !isHomeworkOfChild(doc, child.id)) {
    return (
      <main className="page">
        <PageHeader title={h.title} onBack={back} backLabel={h.backToList} />
        <div className="page__body">
          <EmptyState emoji="🔎" title={h.notFound} />
        </div>
      </main>
    );
  }

  const done = Boolean(doc.homeworkDoneAt);
  const lastPage = Math.max(0, doc.pageCount - 1);
  const drawing = pencilMode === 'annotation';

  const toggleDone = async (): Promise<void> => {
    await setHomeworkDone(doc.id, !done);
    toast.success(done ? h.reopened : h.finished);
  };

  const prepare = async (): Promise<void> => {
    setPreparing(true);
    setFile(null);
    try {
      setFile(await exportHomework(doc, child.id));
      toast.success(h.shareReady);
    } catch {
      toast.error(h.shareFailed);
    } finally {
      setPreparing(false);
    }
  };

  const send = async (prepared: File): Promise<void> => {
    if (!(await shareFile(prepared, doc.title))) downloadFile(prepared);
  };

  return (
    <main className="page hw-page">
      <PageHeader title={doc.title} onBack={back} backLabel={h.backToList} actions={<OfflineBadge />} />
      <div className="page__body">
        <div className="hw-actions" role="toolbar" aria-label={doc.title}>
          {doc.pageCount > 1 && (
            <span className="hw-pager">
              <IconButton icon="◀️" aria-label={h.previousPage} variant="secondary" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => Math.max(0, i - 1))} />
              <span className="hw-pager__label">{format(h.pageOf, { page: pageIndex + 1, total: doc.pageCount })}</span>
              <IconButton icon="▶️" aria-label={h.nextPage} variant="secondary" disabled={pageIndex >= lastPage} onClick={() => setPageIndex((i) => Math.min(lastPage, i + 1))} />
            </span>
          )}
          <Button icon="✏️" variant={drawing ? 'primary' : 'secondary'} aria-pressed={drawing} onClick={() => usePencilStore.getState().setMode(drawing ? 'lecture' : 'annotation')}>
            {h.draw}
          </Button>
          <Button icon="🔊" variant="secondary" onClick={() => void navigate(readerPath(doc.id, pageIndex))}>
            {h.readText}
          </Button>
          <Button icon={done ? '↩️' : '✅'} variant={done ? 'secondary' : 'primary'} onClick={() => void toggleDone()}>
            {done ? h.reopen : h.finish}
          </Button>
          {file ? (
            <Button icon="📤" onClick={() => void send(file)}>
              {h.share}
            </Button>
          ) : (
            <Button icon="📤" variant="secondary" loading={preparing} onClick={() => void prepare()}>
              {h.share}
            </Button>
          )}
          {file && !canShareFile(file) && (
            <Button icon="⬇️" variant="ghost" onClick={() => downloadFile(file)}>
              {file.name}
            </Button>
          )}
        </div>
        <OriginalPageView key={pageIndex} documentId={doc.id} childId={child.id} pageIndex={pageIndex} page={page ?? null} layoutKey={`devoir|${pageIndex}`} startWriting />
      </div>
      <PencilToolbar />
    </main>
  );
}
