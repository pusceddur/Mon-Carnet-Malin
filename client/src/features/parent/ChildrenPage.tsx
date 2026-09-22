import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { Button, EmptyState } from '../../design/components';
import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';
import { useSessionStore } from '../../state/session';
import { ParentPage } from './ParentPage';

const t = parent.children;
const levels = parent.childEdit.readingLevels;

/** Child profiles of the family. */
export default function ChildrenPage(): JSX.Element {
  const navigate = useNavigate();
  const children = useSessionStore((s) => s.children);

  const addButton = (
    <Button size="parent" icon="➕" onClick={() => navigate('nouveau')}>
      {t.add}
    </Button>
  );

  return (
    <ParentPage title={t.title} intro={t.intro} actions={children.length > 0 ? addButton : undefined}>
      {children.length === 0 ? (
        <EmptyState emoji="🧒" title={t.emptyTitle} message={t.emptyMessage} action={addButton} />
      ) : (
        <ul className="parent-list">
          {children.map((child) => (
            <li key={child.id} className="parent-list__item">
              <span className="child-row__avatar" aria-hidden="true">
                {child.avatar}
              </span>
              <span className="parent-list__main">
                <span className="parent-list__title">{child.nickname}</span>
                <span className="parent-list__meta">
                  {levels[child.readingLevel]}
                </span>
              </span>
              <Button variant="secondary" size="parent" onClick={() => navigate(encodeURIComponent(child.id))} aria-label={format(t.editChild, { prenom: child.nickname })}>
                {t.edit}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </ParentPage>
  );
}
