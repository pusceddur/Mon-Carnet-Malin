// STUB: client-shell
import type { JSX } from 'react';
import { Navigate } from 'react-router';
import { useSessionStore } from '../../state/session';

/** `/`: setup -> /installation; not authenticated -> /connexion; no child selected -> /enfant; else /accueil. */
export default function RootRedirect(): JSX.Element {
  const authStatus = useSessionStore((s) => s.authStatus);
  const selectedChildId = useSessionStore((s) => s.selectedChildId);

  let to = '/accueil';
  if (authStatus?.setupRequired) to = '/installation';
  else if (!authStatus?.authenticated) to = '/connexion';
  else if (!selectedChildId) to = '/enfant';
  return <Navigate to={to} replace />;
}
