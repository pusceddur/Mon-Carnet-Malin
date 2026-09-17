import { useId, type JSX, type ReactNode } from 'react';
import { parent } from '../../i18n/fr/parent';
import { useDocumentTitle } from '../../state/useDocumentTitle';
import './parent.css';

export interface ParentPageProps {
  title: string;
  intro?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Page frame inside ParentLayout (the layout owns the h1). */
export function ParentPage({ title, intro, actions, children }: ParentPageProps): JSX.Element {
  useDocumentTitle(`${title} · ${parent.layout.title}`);
  const titleId = useId();
  return (
    <section className="parent-page" aria-labelledby={titleId}>
      <header className="parent-page__header">
        <div className="parent-page__titles">
          <h2 id={titleId} className="parent-page__title">
            {title}
          </h2>
          {intro && <p className="parent-page__intro">{intro}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export interface ParentSectionProps {
  title: string;
  hint?: string;
  children: ReactNode;
}

export function ParentSection({ title, hint, children }: ParentSectionProps): JSX.Element {
  const titleId = useId();
  return (
    <section className="parent-section" aria-labelledby={titleId}>
      <h3 id={titleId} className="parent-section__title">
        {title}
      </h3>
      {hint && <p className="parent-section__hint">{hint}</p>}
      {children}
    </section>
  );
}
