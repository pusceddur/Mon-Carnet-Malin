import { APP_NAME } from '@aide/shared';
import { useEffect } from 'react';

/** Sets « Page · Mon Carnet Malin » as the document title while mounted. */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}
