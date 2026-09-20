import type { ChildProfile, DocumentMeta } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router';
import { db } from '../../db/localDb';
import { Button, ConfirmDialog, EmptyState, IconButton, ProgressBar, Spinner, useToast } from '../../design/components';
import { documentPurpose, usePageImageUrl } from '../../documents/DocumentCache';
import { deleteDocumentEverywhere } from '../../documents/deleteDocument';
import { useDocumentProgress } from '../../documents/ProcessingQueue';
import { DOCUMENT_STATUS_EMOJI } from '../../documents/ui/labels';
import '../../documents/ui/parentDocuments.css';
import { format } from '../../i18n/fr';
import { documents } from '../../i18n/fr/documents';
import { useSessionStore } from '../../state/session';
import { formatDay } from '../homework/homework';
import { ParentPage } from './ParentPage';

const t = documents.admin;

function DocumentRow({ doc, profiles, onDelete }: { doc: DocumentMeta; profiles: readonly ChildProfile[]; onDelete: () => void }): JSX.Element {
  const navigate = useNavigate();
  const progress = useDocumentProgress(doc.id);
  const thumb = usePageImageUrl(doc.id, 0, 'thumb');
  const names = doc.childIds
    .map((id) => profiles.find((c) => c.id === id))
    .filter((c): c is ChildProfile => c !== undefined)
    .map((c) => c.firstName);
  const processing = doc.status === 'processing';
  const done = progress ? progress.ready + progress.lowConfidence + progress.failed : 0;

  return (
    <li className="parent-list__item docs-doc-row">
      <span className="docs-doc-row__thumb" aria-hidden="true">
        {thumb ? <img src={thumb} alt="" /> : <span>📘</span>}
      </span>
      <span className="parent-list__main">
        <span className="parent-list__title">{doc.title}</span>
        <span className="parent-list__meta">
          {format(t.pages, { count: doc.pageCount })} · {names.length > 0 ? names.join(', ') : t.noChild}
        </span>
        <span className={`docs-badge docs-badge--${doc.status}`}>
          <span aria-hidden="true">{DOCUMENT_STATUS_EMOJI[doc.status]} </span>
          {documents.documentStatus[doc.status]}
        </span>
        {documentPurpose(doc) === 'homework' && (
          <span className="docs-badge docs-badge--homework">
            <span aria-hidden="true">📝 </span>
            {doc.homeworkDoneAt ? format(t.homeworkDone, { date: formatDay(doc.homeworkDoneAt) }) : t.homeworkTodo}
          </span>
        )}
        {processing && progress && (
          <ProgressBar
            className="docs-doc-row__progress"
            value={progress.percent}
            label={t.progress}
            valueText={format(t.progressValue, { done, total: progress.total })}
          />
        )}
      </span>
      <span className="docs-doc-row__actions">
        <Button variant="secondary" size="parent" aria-label={format(t.openLabel, { title: doc.title })} onClick={() => navigate(`/parent/documents/${encodeURIComponent(doc.id)}`)}>
          {t.open}
        </Button>
        <IconButton variant="ghost" size="parent" icon="🗑️" aria-label={format(t.delete, { title: doc.title })} onClick={onDelete} />
      </span>
    </li>
  );
}

/** Documents of the family: status, progress, deletion. */
export default function DocumentsAdminPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const children = useSessionStore((s) => s.children);
  const docs = useLiveQuery(
    async () => (await db.documents.toArray()).filter((d) => d.deletedAt === null).sort((a, b) => b.createdAt - a.createdAt),
    [],
    null,
  );
  const [toDelete, setToDelete] = useState<DocumentMeta | null>(null);

  const importButton = (
    <Button size="parent" icon="➕" onClick={() => navigate('/parent/importer')}>
      {t.import}
    </Button>
  );

  const confirmDelete = async (): Promise<void> => {
    if (!toDelete) return;
    try {
      await deleteDocumentEverywhere(toDelete.id);
      toast.success(t.deleted);
    } catch {
      toast.error(t.deleteFailed);
    } finally {
      setToDelete(null);
    }
  };

  return (
    <ParentPage title={t.title} intro={t.intro} actions={docs && docs.length > 0 ? importButton : undefined}>
      {docs === null ? (
        <Spinner />
      ) : docs.length === 0 ? (
        <EmptyState emoji="📚" title={t.emptyTitle} message={t.emptyMessage} action={importButton} />
      ) : (
        <ul className="parent-list">
          {docs.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} profiles={children} onDelete={() => setToDelete(doc)} />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={toDelete !== null}
        size="parent"
        tone="danger"
        title={format(t.confirmTitle, { title: toDelete?.title ?? '' })}
        message={t.confirmMessage}
        confirmLabel={t.confirm}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </ParentPage>
  );
}
