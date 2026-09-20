import type { AuthStatus } from '@aide/shared';

/**
 * - `root`: `/` redirect only
 * - `setup`: /installation (only while setup is required)
 * - `guest`: /connexion, /inscription
 * - `auth`: signed-in parent account (/enfant, /parent)
 * - `child`: signed in with a selected child (child screens)
 */
export type GuardNeed = 'root' | 'setup' | 'guest' | 'auth' | 'child';

export interface GuardSnapshot {
  ready: boolean;
  authStatus: AuthStatus | null;
  hasSelectedChild: boolean;
}

export type GuardDecision = { kind: 'wait' } | { kind: 'allow' } | { kind: 'redirect'; to: string };

export const PATHS = {
  root: '/',
  setup: '/installation',
  login: '/connexion',
  register: '/inscription',
  forgotPassword: '/mot-de-passe-oublie',
  childSelect: '/enfant',
  home: '/accueil',
  books: '/livres',
  homework: '/devoirs',
  exercises: '/exercices',
  notes: '/notes',
  question: '/question',
  parent: '/parent',
  parentChildren: '/parent/enfants',
} as const;

const redirect = (to: string): GuardDecision => ({ kind: 'redirect', to });

/** Where the signed-in state leads from `/`. */
export function homePathFor(s: GuardSnapshot): string {
  if (s.authStatus?.setupRequired) return PATHS.setup;
  if (!s.authStatus?.authenticated) return PATHS.login;
  if (!s.hasSelectedChild) return PATHS.childSelect;
  return PATHS.home;
}

export function resolveGuard(need: GuardNeed, s: GuardSnapshot): GuardDecision {
  if (!s.ready) return { kind: 'wait' };
  const status = s.authStatus;
  switch (need) {
    case 'root':
      return redirect(homePathFor(s));
    case 'setup':
      // Unknown status (offline, no cache): let the page explain that a connection is needed.
      return status === null || status.setupRequired ? { kind: 'allow' } : redirect(PATHS.root);
    case 'guest':
      if (status?.setupRequired) return redirect(PATHS.setup);
      return status?.authenticated ? redirect(PATHS.root) : { kind: 'allow' };
    case 'auth':
      if (status?.setupRequired) return redirect(PATHS.setup);
      return status?.authenticated ? { kind: 'allow' } : redirect(PATHS.login);
    case 'child':
      if (status?.setupRequired) return redirect(PATHS.setup);
      if (!status?.authenticated) return redirect(PATHS.login);
      return s.hasSelectedChild ? { kind: 'allow' } : redirect(PATHS.childSelect);
  }
}

/** Reader URL; `?page=N` is the page number shown to the child (pageIndex + 1), as parsed by the reader. */
export function readerPath(documentId: string, pageIndex?: number | null): string {
  const base = `/lire/${encodeURIComponent(documentId)}`;
  return pageIndex === undefined || pageIndex === null ? base : `${base}?page=${pageIndex + 1}`;
}
