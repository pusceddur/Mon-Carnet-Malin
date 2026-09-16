import { lazy, Suspense, type ComponentType, type JSX, type LazyExoticComponent } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';

// Every page is lazy-loaded (default export of the module listed in contract §11.1).
const RootRedirect = lazy(() => import('./features/auth/RootRedirect'));
const SetupPage = lazy(() => import('./features/auth/SetupPage'));
const LoginPage = lazy(() => import('./features/auth/LoginPage'));
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

/** Text-free placeholder while a page chunk loads (no hardcoded UI strings here). */
function RouteFallback(): JSX.Element {
  return <div className="route-loading" role="status" aria-busy="true" />;
}

function page(Component: LazyExoticComponent<ComponentType>): JSX.Element {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Component />
    </Suspense>
  );
}

export const routes: RouteObject[] = [
  { path: '/', element: page(RootRedirect) },
  { path: '/installation', element: page(SetupPage) },
  { path: '/connexion', element: page(LoginPage) },
  { path: '/enfant', element: page(ChildSelectPage) },
  { path: '/accueil', element: page(ChildHome) },
  { path: '/livres', element: page(MyBooksPage) },
  { path: '/lire/:documentId', element: page(ReaderPage) },
  { path: '/exercices', element: page(ExercisesHome) },
  { path: '/exercices/:documentId/resume', element: page(SummaryPage) },
  { path: '/exercices/:documentId/questions', element: page(QuizSetupPage) },
  { path: '/exercices/quiz/:exerciseId', element: page(QuizPlayerPage) },
  { path: '/notes', element: page(MyNotesPage) },
  {
    path: '/parent',
    element: page(ParentLayout),
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
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export const router = createBrowserRouter(routes);
