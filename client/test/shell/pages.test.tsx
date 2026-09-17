import {
  DEFAULT_EXERCISE_PREFERENCES, DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES,
  type AuthStatus, type ChildProfile,
} from '@aide/shared';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { useSessionStore } from '../../src/state/session';
import { buttonByText, cleanup, click, render, waitFor } from './render';

const auth = vi.hoisted(() => ({
  unlock: vi.fn(),
  lock: vi.fn(),
  getAuthStatus: vi.fn(),
}));

vi.mock('../../src/api/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/api/auth')>();
  return { ...original, unlock: auth.unlock, lock: auth.lock, getAuthStatus: auth.getAuthStatus };
});

const { ApiError } = await import('../../src/api/http');
const { Guard } = await import('../../src/routes');
const ParentLayout = (await import('../../src/features/parent/ParentLayout')).default;
const ChildHome = (await import('../../src/features/home/ChildHome')).default;
const ChildSelectPage = (await import('../../src/features/auth/ChildSelectPage')).default;

function status(patch: Partial<AuthStatus> = {}): AuthStatus {
  return {
    setupRequired: false, authenticated: true, parent: { id: 'p1', email: 'parent@example.org', displayName: 'Parent', createdAt: 1, isOwner: true },
    parentUnlockedUntil: null, pinSet: true, pinLockedUntil: null, registrationOpen: false, ...patch,
  };
}

function child(id: string, firstName: string, avatar = '🦊'): ChildProfile {
  return {
    id, parentId: 'p1', firstName, age: 10, avatar, readingLevel: 'intermediaire', explanationDifficulty: 'simple',
    reading: { ...DEFAULT_READING_PREFERENCES }, tts: { ...DEFAULT_TTS_PREFERENCES }, exercises: { ...DEFAULT_EXERCISE_PREFERENCES },
    createdAt: 1, updatedAt: 1, deletedAt: null,
  };
}

function setSession(patch: Partial<ReturnType<typeof useSessionStore.getState>>): void {
  useSessionStore.setState({ ready: true, online: true, refreshing: false, parentSettings: null, ...patch });
}

async function renderAt(path: string, routes: Parameters<typeof createMemoryRouter>[0]) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const container = await render(<RouterProvider router={router} />);
  return { router, container };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

afterEach(async () => {
  await cleanup();
});

afterAll(() => {
  db.close();
});

describe('route guards', () => {
  it('sends a signed-out visitor to the login page and a reader without child to the selection page', async () => {
    setSession({ authStatus: status({ authenticated: false, parent: null }), children: [], selectedChildId: null });
    const routes = [
      { path: '/accueil', element: <Guard need="child"><p>accueil</p></Guard> },
      { path: '/connexion', element: <p>connexion</p> },
      { path: '/enfant', element: <p>enfant</p> },
    ];
    const first = await renderAt('/accueil', routes);
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/connexion'));
    await cleanup();

    setSession({ authStatus: status(), children: [child('c1', 'Léa')], selectedChildId: null });
    const second = await renderAt('/accueil', routes);
    await waitFor(() => expect(second.router.state.location.pathname).toBe('/enfant'));
    await cleanup();

    setSession({ authStatus: status(), children: [child('c1', 'Léa')], selectedChildId: 'c1' });
    const third = await renderAt('/accueil', routes);
    await waitFor(() => expect(third.container.textContent).toContain('accueil'));
  });

  it('shows a spinner until the cached session is loaded', async () => {
    setSession({ ready: false, authStatus: null, children: [], selectedChildId: null });
    const { container, router } = await renderAt('/accueil', [{ path: '/accueil', element: <Guard need="child"><p>accueil</p></Guard> }]);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(router.state.location.pathname).toBe('/accueil');
  });
});

describe('parent PIN gate', () => {
  const parentRoutes = [
    { path: '/parent', element: <ParentLayout />, children: [{ path: 'enfants', element: <p>liste des enfants</p> }] },
    { path: '/accueil', element: <p>accueil</p> },
    { path: '/enfant', element: <p>enfant</p> },
  ];

  it('asks for the PIN, unlocks through the server and shows the parent navigation', async () => {
    setSession({ authStatus: status(), children: [child('c1', 'Léa')], selectedChildId: 'c1' });
    auth.unlock.mockResolvedValue(status({ parentUnlockedUntil: Date.now() + 15 * 60_000 }));
    const { container } = await renderAt('/parent/enfants', parentRoutes);

    expect(container.textContent).toContain('Code des réglages');
    expect(container.textContent).not.toContain('liste des enfants');
    for (const digit of ['1', '2', '3', '4', '5', '6']) await click(buttonByText(digit, container));
    await click(buttonByText('Valider le code', container));

    await waitFor(() => expect(container.textContent).toContain('liste des enfants'));
    expect(auth.unlock).toHaveBeenCalledWith({ pin: '123456' });
    expect(container.querySelector('nav[aria-label="Menu des réglages"]')).not.toBeNull();
    expect(container.textContent).toContain('Verrouillage automatique à');
  });

  it('shows the wrong PIN message, then the lockout countdown returned by the server', async () => {
    setSession({ authStatus: status(), children: [], selectedChildId: null });
    auth.unlock.mockRejectedValueOnce(new ApiError(401, 'invalid_pin', 'Code incorrect'));
    auth.getAuthStatus.mockResolvedValueOnce(status());
    const { container } = await renderAt('/parent/enfants', parentRoutes);
    for (const digit of ['9', '9', '9', '9']) await click(buttonByText(digit, container));
    await click(buttonByText('Valider le code', container));
    await waitFor(() => expect(container.textContent).toContain('Code incorrect.'));

    auth.unlock.mockRejectedValueOnce(new ApiError(429, 'pin_locked', 'Bloqué'));
    auth.getAuthStatus.mockResolvedValueOnce(status({ pinLockedUntil: Date.now() + 90_000 }));
    for (const digit of ['9', '9', '9', '9']) await click(buttonByText(digit, container));
    await click(buttonByText('Valider le code', container));
    await waitFor(() => expect(container.textContent).toMatch(/Trop d’essais\. Réessayez dans (90 s|2 min)\./));
    expect(buttonByText('1', container)?.disabled).toBe(true);
  });

  it('locks again when the unlock expires and when « Verrouiller » is pressed', async () => {
    setSession({ authStatus: status({ parentUnlockedUntil: Date.now() + 150 }), children: [child('c1', 'Léa')], selectedChildId: 'c1' });
    const first = await renderAt('/parent/enfants', parentRoutes);
    expect(first.container.textContent).toContain('liste des enfants');
    await waitFor(() => expect(first.container.textContent).toContain('Code des réglages'), 3_000);
    await cleanup();

    setSession({ authStatus: status({ parentUnlockedUntil: Date.now() + 60_000 }), children: [child('c1', 'Léa')], selectedChildId: 'c1' });
    auth.lock.mockResolvedValue(status({ parentUnlockedUntil: null }));
    const second = await renderAt('/parent/enfants', parentRoutes);
    await click(buttonByText('Verrouiller', second.container));
    await waitFor(() => expect(second.router.state.location.pathname).toBe('/accueil'));
    expect(useSessionStore.getState().authStatus?.parentUnlockedUntil).toBeNull();
  });

  it('explains that unlocking needs a connection when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    setSession({ authStatus: status(), children: [], selectedChildId: null });
    const { container } = await renderAt('/parent/enfants', parentRoutes);
    expect(container.textContent).toContain('Une connexion Internet est nécessaire pour ouvrir les réglages.');
    expect(buttonByText('1', container)?.disabled).toBe(true);
  });
});

describe('child screens', () => {
  it('greets the child and offers to continue the last book', async () => {
    const lea = child('c1', 'Léa');
    setSession({ authStatus: status(), children: [lea, child('c2', 'Tom', '🐼')], selectedChildId: 'c1' });
    await db.documents.put({
      id: 'd1', ownerParentId: 'p1', childIds: ['c1'], title: 'Le Petit Prince', kind: 'pdf', sourceHash: 'x', pageCount: 30,
      status: 'ready', createdAt: 1, updatedAt: 1, deletedAt: null,
    });
    await db.progress.put({ childId: 'c1', documentId: 'd1', pageIndex: 11, blockIndex: 0, sentenceIndex: 0, updatedAt: 5 });

    const { container, router } = await renderAt('/accueil', [
      { path: '/accueil', element: <ChildHome /> },
      { path: '/lire/:documentId', element: <p>lecteur</p> },
    ]);
    expect(container.querySelector('h1')?.textContent).toBe('👋 Bonjour Léa !');
    for (const label of ['Mes livres', 'Continuer la lecture', 'Exercices', 'Mes notes', 'Réglages']) {
      expect(container.textContent).toContain(label);
    }
    await waitFor(() => expect(container.textContent).toContain('Le Petit Prince · Page 12'));
    expect(buttonByText('Changer de lecteur', container)).not.toBeNull();

    const tile = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Continuer la lecture'));
    await click(tile);
    expect(router.state.location.pathname).toBe('/lire/d1');
    expect(router.state.location.search).toBe('?page=12');
  });

  it('lets the child pick a profile with big avatar buttons', async () => {
    setSession({ authStatus: status(), children: [child('c1', 'Léa'), child('c2', 'Tom', '🐼')], selectedChildId: null });
    const { container, router } = await renderAt('/enfant', [
      { path: '/enfant', element: <ChildSelectPage /> },
      { path: '/accueil', element: <p>accueil</p> },
    ]);
    expect(container.querySelector('h1')?.textContent).toBe('Qui lit aujourd’hui ?');
    await click(buttonByText('C’est moi, Tom', container));
    expect(router.state.location.pathname).toBe('/accueil');
    expect(useSessionStore.getState().selectedChildId).toBe('c2');
    await waitFor(async () => undefined);
    expect((await db.kv.get('selectedChildId'))?.value).toBe('c2');
  });
});
