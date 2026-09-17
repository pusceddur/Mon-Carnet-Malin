import type { DocumentMeta, Id, PageContent } from '@aide/shared';
import type { JSX, ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button, EmptyState } from '../../../design/components';
import { exercises as t } from '../../../i18n/fr/exercises';
import { useDocumentData } from '../hooks';
import { isDocumentVisibleToChild, isReadablePage } from '../lib/documentPages';
import { exercisesHomeLink } from '../lib/links';
import { ExerciseLayout, LoadingBlock } from './ExerciseLayout';

/** Loads a book of the child for a study screen; shows loading, missing and « not ready yet » states itself. */
export function DocumentGate({ documentId, childId, title, children }: {
  documentId: string | undefined;
  childId: Id;
  title: string;
  children: (doc: DocumentMeta, pages: PageContent[]) => ReactNode;
}): JSX.Element {
  const navigate = useNavigate();
  const data = useDocumentData(documentId);
  const doc = data.status === 'ready' && isDocumentVisibleToChild(data.doc, childId) ? data.doc : null;
  const back = (): void => {
    void navigate(exercisesHomeLink(doc?.id));
  };

  if (doc && data.status === 'ready' && data.pages.some(isReadablePage)) return <>{children(doc, data.pages)}</>;

  return (
    <ExerciseLayout title={title} subtitle={doc?.title} onBack={back}>
      {data.status === 'loading' ? (
        <LoadingBlock label={t.common.loadingBook} />
      ) : !doc ? (
        <EmptyState
          emoji="📚"
          title={t.common.bookNotFound.title}
          message={t.common.bookNotFound.message}
          action={<Button onClick={() => void navigate('/exercices')}>{t.common.bookNotFound.action}</Button>}
        />
      ) : (
        <EmptyState emoji="⏳" title={t.common.bookNotReady.title} message={t.common.bookNotReady.message} />
      )}
    </ExerciseLayout>
  );
}
