import type { JSX, ReactNode } from 'react';
import { OfflineBadge, PageHeader, Spinner } from '../../../design/components';
import '../exercises.css';

export function ExerciseLayout({ title, subtitle, onBack, children }: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="ex-screen">
      <PageHeader title={title} subtitle={subtitle} onBack={onBack} actions={<OfflineBadge />} />
      <main className="ex-page">{children}</main>
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }): JSX.Element {
  return (
    <div className="ex-loading">
      <Spinner size="lg" label={label} />
    </div>
  );
}
