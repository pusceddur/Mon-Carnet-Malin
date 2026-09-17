import { lazy, Suspense, type ComponentType, type JSX, type LazyExoticComponent } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { Spinner } from './design/components';
import RouteErrorPage from './features/system/RouteErrorPage';
import { resolveGuard, type GuardNeed } from './state/guards';
import { useSelectedChild, useSessionStore } from './state/session';

// Every page is lazy-loaded (default export of the module listed in contract §11.1).
const SetupPage = lazy(() => import('./features/auth/SetupPage'));
const LoginPage = lazy(() => import('./features/auth/LoginPage'));
const RegisterPage = lazy(() => import('./features/auth/RegisterPage'));
const ChildSelectPage = lazy(() => import('./features/auth/ChildSelectPage'));
const ChildHome = lazy(() => import('./features/home/ChildHome'));
const MyBooksPage = lazy(() => import('./features/library/MyBooksPage'));
const ReaderPage = lazy(() => import('./features/reader/ReaderPage'));
const ExercisesHome = lazy(() => import('./features/exercises/ExercisesHome'));
const SummaryPage = lazy(() => import('./features/exercises/SummaryPage'));
const QuizSetupPage = lazy(() => import('./features/exercises/QuizSetupPage'));
const QuizPlayerPage = lazy(() => import('./features/exercises/QuizPlayerPage'));
const MyNotesPage = lazy(() => import('./features/notes/MyNotesPage'));
const ParentLayout = lazy(() => import('./features/parent/ParentLayout'));
const DocumentsAdminPage = lazy(() => import('./features/parent/DocumentsAdminPage'));
const ImportPage = lazy(() => import('./features/parent/ImportPage'));
const DocumentDetailPage = lazy(() => import('./features/parent/DocumentDetailPage'));
const PageEditorPage = lazy(() => import('./features/parent/PageEditorPage'));
const ChildrenPage = lazy(() => import('./features/parent/ChildrenPage'));
const ChildEditPage = lazy(() => import('./features/parent/ChildEditPage'));
const AISettingsPage = lazy(() => import('./features/parent/AISettingsPage'));
const ActivityPage = lazy(() => import('./features/parent/ActivityPage'));
const GlossaryPage = lazy(() => import('./features/parent/GlossaryPage'));
const SyncPage = lazy(() => import('./features/parent/SyncPage'));
const AccountPage = lazy(() => import('./features/parent/AccountPage'));
const DiagnosticPage = lazy(() => import('./features/parent/DiagnosticPage'));

/** Centered spinner while a page chunk or the cached session loads. */
export function RouteFallback(): JSX.Element {
  return (
    <div className="route-loading">
      <Spinner size="lg" />
    </div>
  );
}

/** Session guard: waits for the cached session, then allows the route or redirects (§11.1). */
export function Guard({ need, children }: { need: GuardNeed; children?: JSX.Element }): JSX.Element {
  const ready = useSessionStore((s) => s.ready);
  const authStatus = useSessionStore((s) => s.authStatus);
  const hasSelectedChild = useSelectedChild() !== null;
  const decision = resolveGuard(need, { ready, authStatus, hasSelectedChild });
  if (decision.kind === 'wait') return <RouteFallback />;
  if (decision.kind === 'redirect') return <Navigate to={decision.to} replace />;
  return children ?? <RouteFallback />;
}

function page(Component: LazyExoticComponent<ComponentType>, need?: GuardNeed): JSX.Element {
  const element = (
    <Suspense fallback={<RouteFallback />}>
      <Component />
    </Suspense>
  );
  return need ? <Guard need={need}>{element}</Guard> : element;
}

export const routes: RouteObject[] = [
  { path: '/', element: <Guard need="root" /> },
  { path: '/installation', element: page(SetupPage, 'setup') },
  { path: '/connexion', element: page(LoginPage, 'guest') },
  { path: '/inscription', element: page(RegisterPage, 'guest') },
  { path: '/enfant', element: page(ChildSelectPage, 'auth') },
  { path: '/accueil', element: page(ChildHome, 'child') },
  { path: '/livres', element: page(MyBooksPage, 'child') },
  { path: '/lire/:documentId', element: page(ReaderPage, 'child') },
  { path: '/exercices', element: page(ExercisesHome, 'child') },
  { path: '/exercices/:documentId/resume', element: page(SummaryPage, 'child') },
  { path: '/exercices/:documentId/questions', element: page(QuizSetupPage, 'child') },
  { path: '/exercices/quiz/:exerciseId', element: page(QuizPlayerPage, 'child') },
  { path: '/notes', element: page(MyNotesPage, 'child') },
  {
    path: '/parent',
    // The PIN gate itself lives in ParentLayout (server-side unlock, C8).
    element: page(ParentLayout, 'auth'),
    children: [
      { index: true, element: <Navigate to="documents" replace /> },
      { path: 'documents', element: page(DocumentsAdminPage) },
      { path: 'importer', element: page(ImportPage) },
      { path: 'documents/:documentId', element: page(DocumentDetailPage) },
      { path: 'documents/:documentId/pages/:pageIndex', element: page(PageEditorPage) },
      { path: 'enfants', element: page(ChildrenPage) },
      { path: 'enfants/:childId', element: page(ChildEditPage) },
      { path: 'ia', element: page(AISettingsPage) },
      { path: 'activite', element: page(ActivityPage) },
      { path: 'glossaire', element: page(GlossaryPage) },
      { path: 'synchronisation', element: page(SyncPage) },
      { path: 'compte', element: page(AccountPage) },
      { path: 'diagnostic', element: page(DiagnosticPage) },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

/** Every route shares the French error screen (failed chunk load, render error). */
function withErrorElement(list: RouteObject[]): RouteObject[] {
  return list.map((route) => ({ ...route, errorElement: <RouteErrorPage /> }) as RouteObject);
}

export const router = createBrowserRouter(withErrorElement(routes));
