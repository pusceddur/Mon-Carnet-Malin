import { APP_NAME } from '@aide/shared';
import { useEffect, type JSX } from 'react';
import { Button } from '../../design/components';
import '../../design/system.css';
import { common } from '../../i18n/fr/common';
import { useOnlineStatus } from '../../platform/online';

/**
 * Router error element: a page chunk that fails to load (offline before the app was cached, new version deployed while
 * the app was open) or a render error shows a calm French screen instead of the router's default developer page.
 */
export default function RouteErrorPage(): JSX.Element {
  const t = common.routeError;
  const online = useOnlineStatus();

  useEffect(() => {
    const previous = document.title;
    document.title = `${t.documentTitle} · ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [t.documentTitle]);

  return (
    <main className="sys-page">
      <div className="sys-card" role="alert">
        <span className="sys-card__emoji" aria-hidden="true">
          🧩
        </span>
        <h1 className="sys-card__title">{t.title}</h1>
        <p className="sys-card__lead">{t.lead}</p>
        {!online && <p className="sys-card__lead">{t.offline}</p>}
        <Button block onClick={() => window.location.reload()}>
          {t.retry}
        </Button>
        <Button block variant="ghost" onClick={() => window.location.assign('/')}>
          {t.home}
        </Button>
      </div>
    </main>
  );
}
