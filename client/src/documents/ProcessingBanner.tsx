// STUB: client-documents
import type { Id } from '@aide/shared';
import type { JSX } from 'react';

/** « Chapitre ████░░ 52 % · Page 13 disponible · Préparation des pages suivantes… » */
export function ProcessingBanner(props: { documentId: Id }): JSX.Element {
  return <div className="processing-banner" data-document-id={props.documentId} hidden />;
}
