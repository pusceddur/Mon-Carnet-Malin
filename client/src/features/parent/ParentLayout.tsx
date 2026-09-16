// STUB: client-shell
import type { JSX } from 'react';
import { Outlet } from 'react-router';

/** PIN gate (server-side unlock, C8) + parent navigation; renders child routes in <Outlet />. */
export default function ParentLayout(): JSX.Element {
  return (
    <main className="page page--stub parent-layout">
      <h1>Espace parent</h1>
      <Outlet />
    </main>
  );
}
