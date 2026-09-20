import type { DocumentMeta } from '@aide/shared';
import { useRef, useState, type ChangeEvent, type JSX } from 'react';
import { useNavigate } from 'react-router';
import { Button, EmptyState, Field, OfflineBadge, PageHeader, Spinner, TextInput, useToast } from '../../design/components';
import { detectFileKind } from '../../documents/DocumentParser';
import { ImportError, importFiles } from '../../documents/ImportService';
import { format } from '../../i18n/fr';
import { documents } from '../../i18n/fr/documents';
import { homework as h } from '../../i18n/fr/homework';
import { library } from '../../i18n/fr/library';
import { PATHS } from '../../state/guards';
import { useSelectedChild } from '../../state/session';
import { useDocumentTitle } from '../../state/useDocumentTitle';
import { useObjectUrl, usePageThumbBlob } from '../library/books';
import '../library/library.css';
import { formatDay, homeworkPath, useChildHomework } from './homework';
import './homework.css';

const ACCEPT_FILES = 'image/*,.heic,.heif,application/pdf,.pdf';

function HomeworkCard({ document }: { document: DocumentMeta }): JSX.Element {
  const navigate = useNavigate();
  const thumb = useObjectUrl(usePageThumbBlob(document.id));
  const pages = format(document.pageCount === 1 ? library.pageCountOne : library.pageCountMany, { count: document.pageCount });
  return (
    <li className="book-card">
      <button type="button" className="book-card__open" onClick={() => navigate(homeworkPath(document.id))}>
        <span className="book-card__cover" aria-hidden="true">
          {thumb ? <img src={thumb} alt="" className="book-card__img" draggable={false} /> : <span className="book-card__placeholder">📝</span>}
        </span>
        <span className="book-card__body">
          <span className="book-card__title">{document.title.trim() || h.untitled}</span>
          <span className="book-card__meta">
            {document.homeworkDoneAt
              ? format(h.doneOn, { date: formatDay(document.homeworkDoneAt) })
              : format(h.addedOn, { date: formatDay(document.createdAt) })}
            <span aria-hidden="true"> · </span>
            {pages}
          </span>
        </span>
      </button>
    </li>
  );
}

/** « Mes devoirs » (§19.3): add a sheet to complete (photo, screenshot, PDF), homework to do and done. */
export default function HomeworkListPage(): JSX.Element {
  useDocumentTitle(h.documentTitle);
  const navigate = useNavigate();
  const toast = useToast();
  const child = useSelectedChild();
  const lists = useChildHomework(child?.id ?? null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const filesInput = useRef<HTMLInputElement | null>(null);

  const add = async (files: File[]): Promise<void> => {
    if (!child || files.length === 0 || busy) return;
    if (files.some((f) => detectFileKind(f) === 'epub')) {
      toast.error(documents.importPage.errors.unsupported_file);
      return;
    }
    setBusy(true);
    try {
      const title = name.trim() || format(h.defaultTitle, { date: formatDay(Date.now()) });
      const id = await importFiles(files, { title, childIds: [child.id], purpose: 'homework' });
      setName('');
      void navigate(homeworkPath(id));
    } catch (error) {
      toast.error(documents.importPage.errors[error instanceof ImportError ? error.code : 'generic']);
    } finally {
      setBusy(false);
    }
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void add(files);
  };

  return (
    <main className="page">
      <PageHeader title={h.title} onBack={() => navigate(PATHS.home)} backLabel={h.back} actions={<OfflineBadge />} />
      <div className="page__body hw-list">
        <section className="hw-add" aria-labelledby="hw-add-title">
          <h2 id="hw-add-title" className="hw-section-title">
            <span aria-hidden="true">➕ </span>
            {h.addTitle}
          </h2>
          <p className="hw-hint">{h.addHint}</p>
          <Field label={h.nameLabel}>
            <TextInput value={name} maxLength={200} autoComplete="off" placeholder={h.namePlaceholder} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="hw-add__buttons">
            <Button icon="📷" loading={busy} onClick={() => cameraInput.current?.click()}>
              {h.takePhoto}
            </Button>
            <Button icon="📁" variant="secondary" disabled={busy} onClick={() => filesInput.current?.click()}>
              {h.chooseFile}
            </Button>
          </div>
          {busy && (
            <p className="hw-hint" role="status">
              {h.adding}
            </p>
          )}
          <input ref={cameraInput} className="visually-hidden" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={onInput} />
          <input ref={filesInput} className="visually-hidden" type="file" accept={ACCEPT_FILES} multiple tabIndex={-1} aria-hidden="true" onChange={onInput} />
        </section>

        {lists === undefined ? (
          <div className="route-loading">
            <Spinner size="lg" />
          </div>
        ) : lists.todo.length === 0 && lists.done.length === 0 ? (
          <EmptyState emoji="📝" title={h.emptyTitle} message={h.emptyMessage} />
        ) : (
          <>
            <section aria-labelledby="hw-todo-title">
              <h2 id="hw-todo-title" className="hw-section-title">
                {h.todo}
              </h2>
              {lists.todo.length === 0 ? (
                <p className="hw-hint">{h.noneTodo}</p>
              ) : (
                <ul className="book-grid">
                  {lists.todo.map((d) => (
                    <HomeworkCard key={d.id} document={d} />
                  ))}
                </ul>
              )}
            </section>
            {lists.done.length > 0 && (
              <section aria-labelledby="hw-done-title">
                <h2 id="hw-done-title" className="hw-section-title">
                  {h.done}
                </h2>
                <ul className="book-grid">
                  {lists.done.map((d) => (
                    <HomeworkCard key={d.id} document={d} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
