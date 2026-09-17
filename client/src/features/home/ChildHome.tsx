import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { Button, IconButton, OfflineBadge, Tile } from '../../design/components';
import { format } from '../../i18n/fr';
import { home } from '../../i18n/fr/home';
import { PATHS, readerPath } from '../../state/guards';
import { useSelectedChild, useSessionStore } from '../../state/session';
import { useDocumentTitle } from '../../state/useDocumentTitle';
import { useChildBooks } from '../library/books';
import './home.css';

/** Child home: greeting, four big tiles, discreet parent access (§11.1, §12). */
export default function ChildHome(): JSX.Element {
  useDocumentTitle(home.documentTitle);
  const navigate = useNavigate();
  const child = useSelectedChild();
  const childCount = useSessionStore((s) => s.children.length);
  const books = useChildBooks(child?.id ?? null);
  // Books are sorted last read first.
  const current = books?.find((b) => b.progress !== null) ?? null;

  const continueReading = (): void => {
    if (current?.progress) navigate(readerPath(current.document.id, current.progress.pageIndex));
    else navigate(PATHS.books);
  };

  return (
    <main className="child-home">
      <header className="child-home__header">
        <h1 className="child-home__greeting">
          <span aria-hidden="true">👋 </span>
          {child ? format(home.greeting, { prenom: child.firstName }) : home.greetingNoName}
        </h1>
        <div className="child-home__header-actions">
          <OfflineBadge />
          {childCount > 1 && child && (
            <IconButton
              aria-label={home.switchChild}
              icon={<span className="child-home__avatar">{child.avatar}</span>}
              variant="secondary"
              onClick={() => navigate(PATHS.childSelect)}
            />
          )}
        </div>
      </header>

      <nav className="child-home__tiles" aria-label={home.documentTitle}>
        <Tile emoji="📚" label={home.tiles.books} tone="blue" onClick={() => navigate(PATHS.books)} />
        <Tile
          emoji="📖"
          label={home.tiles.continue}
          description={
            current?.progress
              ? `${current.document.title} · ${format(home.continuePage, { page: current.progress.pageIndex + 1 })}`
              : home.continueNone
          }
          tone="warm"
          onClick={continueReading}
        />
        <Tile emoji="🧠" label={home.tiles.exercises} tone="violet" onClick={() => navigate(PATHS.exercises)} />
        <Tile emoji="✏️" label={home.tiles.notes} tone="green" onClick={() => navigate(PATHS.notes)} />
      </nav>

      <footer className="child-home__footer">
        <Button variant="ghost" size="child" icon="🔒" className="child-home__parent" onClick={() => navigate(PATHS.parent)}>
          {home.parentAccess}
        </Button>
      </footer>
    </main>
  );
}
