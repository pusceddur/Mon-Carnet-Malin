import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { Button, EmptyState, OfflineBadge, Spinner } from '../../design/components';
import { format } from '../../i18n/fr';
import { home } from '../../i18n/fr/home';
import { PATHS } from '../../state/guards';
import { useSessionStore } from '../../state/session';
import { useDocumentTitle } from '../../state/useDocumentTitle';
import './auth.css';

const t = home.childSelect;

/** « Qui lit aujourd’hui ? »: big avatars, one tap selects the reader for this device. */
export default function ChildSelectPage(): JSX.Element {
  useDocumentTitle(t.documentTitle);
  const navigate = useNavigate();
  const children = useSessionStore((s) => s.children);
  const selectedChildId = useSessionStore((s) => s.selectedChildId);
  const refreshing = useSessionStore((s) => s.refreshing);

  const choose = (childId: string): void => {
    void useSessionStore.getState().selectChild(childId);
    navigate(PATHS.home);
  };

  return (
    <main className="child-select">
      <OfflineBadge />
      {children.length === 0 && refreshing ? (
        <Spinner size="lg" />
      ) : children.length === 0 ? (
        <EmptyState
          emoji="🧒"
          title={t.emptyTitle}
          message={t.emptyMessage}
          action={
            <Button variant="secondary" icon="🔒" onClick={() => navigate(PATHS.parentChildren)}>
              {t.emptyAction}
            </Button>
          }
        />
      ) : (
        <>
          <h1 className="child-select__title">{t.title}</h1>
          <ul className="child-select__grid">
            {children.map((child) => (
              <li key={child.id}>
                <button
                  type="button"
                  className="child-card"
                  aria-label={format(t.choose, { prenom: child.nickname })}
                  aria-current={child.id === selectedChildId ? 'true' : undefined}
                  onClick={() => choose(child.id)}
                >
                  <span className="child-card__avatar" aria-hidden="true">
                    {child.avatar}
                  </span>
                  <span className="child-card__name">{child.nickname}</span>
                </button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="child" icon="🔒" className="child-select__parent" onClick={() => navigate(PATHS.parent)}>
            {home.parentAccess}
          </Button>
        </>
      )}
    </main>
  );
}
