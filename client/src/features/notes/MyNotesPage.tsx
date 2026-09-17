import type { Annotation, DocumentMeta, Id, PageContent } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { db } from '../../db/localDb';
import { Button, EmptyState, OfflineBadge, PageHeader, Spinner } from '../../design/components';
import { format } from '../../i18n/fr';
import { notes } from '../../i18n/fr/notes';
import { reanchor } from '../../pencil/anchoring';
import { PATHS, readerPath } from '../../state/guards';
import { useSelectedChild } from '../../state/session';
import { useDocumentTitle } from '../../state/useDocumentTitle';
import { buildNotes, pagesNeededForNotes, type DocumentNotes } from './notesModel';
import './notes.css';

const isDefined = <T,>(value: T | undefined): value is T => value !== undefined;

async function loadNotes(childId: Id): Promise<DocumentNotes[]> {
  const [annotations, exercises, answers] = await Promise.all([
    db.annotations.where('childId').equals(childId).filter((a: Annotation) => a.deletedAt === null).toArray(),
    db.exercises.where('childId').equals(childId).toArray(),
    db.answers.where('childId').equals(childId).toArray(),
  ]);
  const documentIds = new Set<Id>();
  for (const a of annotations) if (a.documentId !== null) documentIds.add(a.documentId);
  for (const e of exercises) documentIds.add(e.documentId);
  const [documents, pages] = await Promise.all([
    db.documents.bulkGet(Array.from(documentIds)),
    db.pages.bulkGet(pagesNeededForNotes(annotations)),
  ]);
  return buildNotes({
    documents: documents.filter(isDefined) as DocumentMeta[],
    pages: pages.filter(isDefined) as PageContent[],
    annotations,
    exercises,
    answers,
    reanchor,
  });
}

function DocumentNotesCard({ group }: { group: DocumentNotes }): JSX.Element {
  const navigate = useNavigate();
  const title = group.title.trim() || notes.untitled;
  const open = (pageIndex: number | null): void => {
    void navigate(readerPath(group.documentId, pageIndex));
  };

  return (
    <section className="notes-card" aria-label={title}>
      <header className="notes-card__header">
        <h2 className="notes-card__title">
          <span aria-hidden="true">📘 </span>
          {title}
        </h2>
        <Button variant="secondary" size="child" icon="📖" onClick={() => open(group.firstPageIndex)}>
          {notes.openBook}
        </Button>
      </header>

      {group.highlights.length > 0 && (
        <div className="notes-card__section">
          <h3 className="notes-card__subtitle">
            <span aria-hidden="true">🖍️ </span>
            {notes.highlights}
          </h3>
          <ul className="notes-list">
            {group.highlights.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="note-item"
                  onClick={() => open(h.pageIndex)}
                  aria-label={`${h.text} · ${format(notes.openAtPage, { page: h.pageIndex + 1 })}`}
                >
                  <mark className="note-item__mark" style={{ backgroundColor: h.color }}>
                    {h.text}
                  </mark>
                  <span className="note-item__page">{format(notes.page, { page: h.pageIndex + 1 })}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {group.inkCount > 0 && (
        <p className="notes-card__ink">
          <span aria-hidden="true">✏️ </span>
          {format(group.inkCount === 1 ? notes.drawingsOne : notes.drawingsMany, { count: group.inkCount })}
        </p>
      )}

      {group.answers.length > 0 && (
        <div className="notes-card__section">
          <h3 className="notes-card__subtitle">
            <span aria-hidden="true">💬 </span>
            {notes.answers}
          </h3>
          <ul className="notes-list">
            {group.answers.map((a) => (
              <li key={a.id} className="note-answer">
                {a.prompt && <p className="note-answer__prompt">{a.prompt}</p>}
                <p className="note-answer__text">{a.text ?? notes.drawnAnswer}</p>
                <Button variant="ghost" size="child" onClick={() => navigate(`/exercices/quiz/${encodeURIComponent(a.exerciseId)}`)}>
                  {notes.openQuiz}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {group.detached.length > 0 && (
        <div className="notes-card__section">
          <h3 className="notes-card__subtitle">
            <span aria-hidden="true">📌 </span>
            {notes.detached}
          </h3>
          <p className="notes-card__hint">{notes.detachedHint}</p>
          <ul className="notes-list">
            {group.detached.map((d) => (
              <li key={d.id}>
                <button type="button" className="note-item note-item--detached" onClick={() => open(d.pageIndex)}>
                  <span className="note-item__badge">{notes.detached}</span>
                  <span className="note-item__text">{d.text || notes.detachedDrawing}</span>
                  <span className="note-item__page">{format(notes.page, { page: d.pageIndex + 1 })}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** « Mes notes »: highlights, drawings, written answers and detached notes, grouped by book. */
export default function MyNotesPage(): JSX.Element {
  useDocumentTitle(notes.documentTitle);
  const navigate = useNavigate();
  const child = useSelectedChild();
  const childId = child?.id ?? null;
  const groups = useLiveQuery(() => (childId === null ? [] : loadNotes(childId)), [childId]);

  return (
    <main className="page">
      <PageHeader title={notes.title} onBack={() => navigate(PATHS.home)} backLabel={notes.back} actions={<OfflineBadge />} />
      <div className="page__body page__body--narrow">
        {groups === undefined ? (
          <div className="route-loading">
            <Spinner size="lg" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState emoji="✏️" title={notes.emptyTitle} message={notes.emptyMessage} />
        ) : (
          groups.map((group) => <DocumentNotesCard key={group.documentId} group={group} />)
        )}
      </div>
    </main>
  );
}
