import type { ChildProfile } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX, ReactNode } from 'react';
import { Navigate } from 'react-router';
import { db } from '../../../db/localDb';
import { Spinner } from '../../../design/components';
import { exercises as t } from '../../../i18n/fr/exercises';
import { useSelectedChild, useSessionStore } from '../../../state/session';

const MISSING = null;

/** Renders its children with the selected child profile; waits for the session, otherwise goes back to `/`. */
export function ChildGate({ children }: { children: (child: ChildProfile) => ReactNode }): JSX.Element {
  const selectedChildId = useSessionStore((s) => s.selectedChildId);
  const authLoaded = useSessionStore((s) => s.authStatus !== null);
  const fromStore = useSelectedChild();
  const fromDb = useLiveQuery(
    async () => (fromStore || !selectedChildId ? MISSING : ((await db.children.get(selectedChildId)) ?? MISSING)),
    [fromStore, selectedChildId],
  );

  const child = fromStore ?? (fromDb && fromDb.deletedAt === null ? fromDb : null);
  if (child) return <>{children(child)}</>;

  const waiting = selectedChildId ? fromDb === undefined : !authLoaded;
  if (waiting) {
    return (
      <main className="ex-page ex-page--center">
        <Spinner size="lg" label={t.childGate.loading} />
      </main>
    );
  }
  return <Navigate to="/" replace />;
}
