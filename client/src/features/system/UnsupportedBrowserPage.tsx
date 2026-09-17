import { APP_NAME } from '@aide/shared';
import { useEffect, useId, type JSX } from 'react';
import { Button } from '../../design/components';
import '../../design/system.css';
import { format } from '../../i18n/fr';
import { common } from '../../i18n/fr/common';
import { checkBrowserSupport, FEATURE_WEBASSEMBLY } from '../../platform/support';

export interface UnsupportedBrowserPageProps {
  /** Missing required features (default: detected now). */
  missing?: readonly string[];
}

/** Shown instead of the app when a required browser feature is missing (contract §15.6). */
export default function UnsupportedBrowserPage({ missing }: UnsupportedBrowserPageProps): JSX.Element {
  const t = common.unsupported;
  const stepsId = useId();
  const list = missing ?? checkBrowserSupport().missing;
  // WebAssembly missing on an up-to-date iPad usually means Lockdown Mode.
  const lockdownLikely = list.includes(FEATURE_WEBASSEMBLY);

  useEffect(() => {
    const previous = document.title;
    document.title = `${t.documentTitle} · ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [t.documentTitle]);

  return (
    <main className="sys-page">
      <div className="sys-card">
        <span className="sys-card__emoji" aria-hidden="true">
          🧭
        </span>
        <h1 className="sys-card__title">{t.title}</h1>
        <p className="sys-card__lead">{format(t.intro, { app: APP_NAME })}</p>
        <p className="sys-card__lead">{t.askAdult}</p>

        <section className="sys-steps" aria-labelledby={stepsId}>
          <h2 id={stepsId} className="sys-steps__title">
            {t.stepsTitle}
          </h2>
          <ol className="sys-steps__list">
            <li>{t.stepUpdate}</li>
            <li>{t.stepSafari}</li>
            {lockdownLikely && <li>{t.stepLockdown}</li>}
          </ol>
        </section>

        {list.length > 0 && (
          <details className="sys-details">
            <summary>{t.detailsTitle}</summary>
            <p>
              {t.missingLabel} {list.join(', ')}
            </p>
          </details>
        )}

        <Button block onClick={() => window.location.reload()}>
          {t.retry}
        </Button>
      </div>
    </main>
  );
}
