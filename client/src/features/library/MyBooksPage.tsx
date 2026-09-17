import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { EmptyState, OfflineBadge, PageHeader, ProgressBar, Spinner } from '../../design/components';
import { useDocumentProgress } from '../../documents/ProcessingQueue';
import { format } from '../../i18n/fr';
import { library } from '../../i18n/fr/library';
import { PATHS, readerPath } from '../../state/guards';
import { useSelectedChild } from '../../state/session';
import { useDocumentTitle } from '../../state/useDocumentTitle';
import { useChildBooks, useObjectUrl, usePageThumbBlob, type BookItem } from './books';
import './library.css';

function BookCover({ documentId }: { documentId: string }): JSX.Element {
  const url = useObjectUrl(usePageThumbBlob(documentId));
  return (
    <span className="book-card__cover" aria-hidden="true">
      {url ? <img src={url} alt="" className="book-card__img" draggable={false} /> : <span className="book-card__placeholder">📘</span>}
    </span>
  );
}

function BookCard({ item }: { item: BookItem }): JSX.Element {
  const navigate = useNavigate();
  const { document, progress } = item;
  const processing = useDocumentProgress(document.id);
  const title = document.title.trim() || library.untitled;
  // Pages may still be processed on another device (no local pages yet): indeterminate bar.
  const known = processing !== null && processing.total > 0;
  const readable = known ? processing.ready + processing.lowConfidence : 0;
  const preparing = document.status === 'processing' && (!known || processing.percent < 100);
  const pageCount = format(document.pageCount === 1 ? library.pageCountOne : library.pageCountMany, { count: document.pageCount });

  return (
    <li className="book-card">
      <button
        type="button"
        className="book-card__open"
        onClick={() => navigate(readerPath(document.id, progress?.pageIndex ?? null))}
      >
        <BookCover documentId={document.id} />
        <span className="book-card__body">
          <span className="book-card__title">{title}</span>
          <span className="book-card__meta">
            {progress ? format(library.lastPage, { page: progress.pageIndex + 1 }) : library.notStarted}
            <span aria-hidden="true"> · </span>
            {pageCount}
          </span>
        </span>
      </button>
      {preparing && (
        <div className="book-card__progress">
          <ProgressBar
            label={library.preparing}
            value={known ? processing.percent : null}
            valueText={known ? format(library.readyPages, { ready: readable, total: processing.total }) : undefined}
            tone="warm"
          />
        </div>
      )}
    </li>
  );
}

/** « Mes livres »: books assigned to the selected child, last read first. */
export default function MyBooksPage(): JSX.Element {
  useDocumentTitle(library.documentTitle);
  const navigate = useNavigate();
  const child = useSelectedChild();
  const books = useChildBooks(child?.id ?? null);

  return (
    <main className="page">
      <PageHeader title={library.title} onBack={() => navigate(PATHS.home)} backLabel={library.back} actions={<OfflineBadge />} />
      <div className="page__body">
        {books === undefined ? (
          <div className="route-loading">
            <Spinner size="lg" />
          </div>
        ) : books.length === 0 ? (
          <EmptyState emoji="📚" title={library.emptyTitle} message={library.emptyMessage} />
        ) : (
          <ul className="book-grid">
            {books.map((item) => (
              <BookCard key={item.document.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
