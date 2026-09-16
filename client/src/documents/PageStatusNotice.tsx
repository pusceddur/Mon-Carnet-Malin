// STUB: client-documents
import type { PageContent } from '@aide/shared';
import type { JSX } from 'react';

/** ⚠️ low confidence / page not ready / failed notice for a page. */
export function PageStatusNotice(props: { page: PageContent }): JSX.Element {
  return <div className="page-status-notice" data-status={props.page.status} hidden />;
}
