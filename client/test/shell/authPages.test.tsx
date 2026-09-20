import type { AuthStatus } from '@aide/shared';
import { act } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { useSessionStore } from '../../src/state/session';
import { buttonByText, cleanup, click, render, waitFor } from './render';

const auth = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  register: vi.fn(),
}));
const admin = vi.hoisted(() => ({
  getInvitation: vi.fn(),
  updateInvitation: vi.fn(),
}));

vi.mock('../../src/api/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/api/auth')>();
  return { ...original, getAuthStatus: auth.getAuthStatus, register: auth.register };
});
vi.mock('../../src/api/admin', () => admin);
vi.mock('../../src/sync/SyncEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/sync/SyncEngine')>();
  return { ...original, syncNow: vi.fn(async () => undefined) };
});

const { ApiError } = await import('../../src/api/http');
const LoginPage = (await import('../../src/features/auth/LoginPage')).default;
const RegisterPage = (await import('../../src/features/auth/RegisterPage')).default;
const AccountPage = (await import('../../src/features/parent/AccountPage')).default;

const CLOSED = 'Les inscriptions ne sont pas ouvertes. Demandez un code d’invitation.';

function signedOut(registrationOpen: boolean, passwordResetAvailable = false): AuthStatus {
  return {
    setupRequired: false, authenticated: false, parent: null, parentUnlockedUntil: null, pinSet: false, pinLockedUntil: null, registrationOpen,
    pinRequired: true, passwordResetAvailable, aiReading: false,
  };
}

function signedIn(): AuthStatus {
  return {
    setupRequired: false, authenticated: true, parentUnlockedUntil: null, pinSet: true, pinLockedUntil: null, registrationOpen: true, pinRequired: true, passwordResetAvailable: false, aiReading: false,
    parent: { id: 'p2', email: 'nouveau@example.org', displayName: 'Alex', createdAt: 1, isOwner: false },
  };
}

function setCachedStatus(authStatus: AuthStatus): void {
  useSessionStore.setState({ ready: true, online: true, refreshing: false, authStatus, children: [], selectedChildId: null, parentSettings: null });
}

async function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/connexion', element: <LoginPage /> },
      { path: '/inscription', element: <RegisterPage /> },
      { path: '/', element: <p>accueil</p> },
    ],
    { initialEntries: [path] },
  );
  const container = await render(<RouterProvider router={router} />);
  return { router, container };
}

function inputByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const found = Array.from(container.querySelectorAll('label')).find((l) => l.firstChild?.textContent?.trim() === label);
  const input = found ? container.querySelector<HTMLInputElement>(`[id="${found.htmlFor}"]`) : null;
  if (!input) throw new Error(`input not found: ${label}`);
  return input;
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function fillRegisterForm(container: HTMLElement, patch: Partial<Record<string, string>> = {}): Promise<void> {
  const values: Record<string, string> = {
    'Code d’invitation': ' k7qm-3fxa-9trd ',
    'Votre prénom': ' Alex ',
    'E-mail': ' Nouveau@Example.org ',
    'Mot de passe': 'motdepasse-solide',
    'Confirmer le mot de passe': 'motdepasse-solide',
    'Code des réglages': '246810',
    'Confirmer le code des réglages': '246810',
    ...patch,
  };
  for (const [label, value] of Object.entries(values)) await typeInto(inputByLabel(container, label), value ?? '');
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  // Account data loaded after sign-in is not under test.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status: 404 })));
});

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

afterAll(() => {
  db.close();
});

describe('LoginPage', () => {
  it('has no « Première installation » button and hides « Créer un compte » while registrations are closed', async () => {
    setCachedStatus(signedOut(false));
    auth.getAuthStatus.mockResolvedValue(signedOut(false));
    const { container } = await renderAt('/connexion');
    await waitFor(() => expect(auth.getAuthStatus).toHaveBeenCalled());
    expect(container.querySelector('h1')?.textContent).toBe('Connexion');
    expect(container.textContent).not.toContain('Première installation');
    expect(buttonByText('Créer un compte', container)).toBeNull();
  });

  it('re-reads the status on mount and shows « Créer un compte » when registrations are open', async () => {
    setCachedStatus(signedOut(false));
    auth.getAuthStatus.mockResolvedValue(signedOut(true));
    const { container, router } = await renderAt('/connexion');
    await waitFor(() => expect(buttonByText('Créer un compte', container)).not.toBeNull());
    await click(buttonByText('Créer un compte', container));
    expect(router.state.location.pathname).toBe('/inscription');
  });

  it('hides the button again when the server closed registrations since the status was cached', async () => {
    setCachedStatus(signedOut(true));
    auth.getAuthStatus.mockResolvedValue(signedOut(false));
    const { container } = await renderAt('/connexion');
    await waitFor(() => expect(buttonByText('Créer un compte', container)).toBeNull());
  });
});

describe('RegisterPage', () => {
  it('explains that registrations are closed and leads back to the login page', async () => {
    setCachedStatus(signedOut(false));
    auth.getAuthStatus.mockResolvedValue(signedOut(false));
    const { container, router } = await renderAt('/inscription');
    await waitFor(() => expect(container.textContent).toContain(CLOSED));
    expect(container.querySelector('form')).toBeNull();
    await click(buttonByText('Retour à la connexion', container));
    expect(router.state.location.pathname).toBe('/connexion');
  });

  it('validates the fields in French without calling the server', async () => {
    setCachedStatus(signedOut(true));
    auth.getAuthStatus.mockResolvedValue(signedOut(true));
    const { container } = await renderAt('/inscription');
    await waitFor(() => expect(auth.getAuthStatus).toHaveBeenCalled());

    await click(buttonByText('Créer le compte', container));
    await waitFor(() => expect(container.querySelectorAll('.ui-field__error').length).toBe(5));
    expect(container.textContent).toContain('Ce champ est obligatoire.');

    await fillRegisterForm(container, { 'Code d’invitation': 'abc', 'Confirmer le mot de passe': 'autre-mot-de-passe', 'Confirmer le code des réglages': '135790' });
    await click(buttonByText('Créer le compte', container));
    await waitFor(() => expect(container.textContent).toContain('De 8 à 64 lettres, chiffres ou tirets.'));
    expect(container.textContent).toContain('Les mots de passe ne sont pas identiques.');
    expect(container.textContent).toContain('Les codes ne sont pas identiques.');
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('creates the account, opens the session and goes to the home redirect', async () => {
    setCachedStatus(signedOut(true));
    auth.getAuthStatus.mockResolvedValueOnce(signedOut(true)).mockResolvedValue(signedIn());
    auth.register.mockResolvedValue(signedIn());
    const { container, router } = await renderAt('/inscription');
    await waitFor(() => expect(inputByLabel(container, 'Code d’invitation')).toBeDefined());

    await fillRegisterForm(container);
    await click(buttonByText('Créer le compte', container));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(auth.register).toHaveBeenCalledWith({
      inviteCode: 'k7qm-3fxa-9trd', displayName: 'Alex', email: 'nouveau@example.org', password: 'motdepasse-solide', pin: '246810',
    });
    expect(useSessionStore.getState().authStatus).toMatchObject({ authenticated: true, parent: { email: 'nouveau@example.org', isOwner: false } });
  });

  it('shows the French message of a wrong invitation code and keeps the form', async () => {
    setCachedStatus(signedOut(true));
    auth.getAuthStatus.mockResolvedValue(signedOut(true));
    auth.register.mockRejectedValueOnce(new ApiError(403, 'invalid_invitation', 'Refusé'));
    const { container, router } = await renderAt('/inscription');
    await waitFor(() => expect(auth.getAuthStatus).toHaveBeenCalled());

    await fillRegisterForm(container);
    await click(buttonByText('Créer le compte', container));
    await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe('Code d’invitation incorrect, ou inscriptions fermées.'));
    expect(router.state.location.pathname).toBe('/inscription');
    expect(useSessionStore.getState().authStatus?.authenticated).toBe(false);

    auth.register.mockRejectedValueOnce(new ApiError(429, 'too_many_attempts', 'Bloqué'));
    await click(buttonByText('Créer le compte', container));
    await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('Trop d’essais avec un code d’invitation'));
  });
});

describe('AccountPage: invitations', () => {
  const CODE = 'K7QM-3FXA-9TRD';

  function unlockedStatus(isOwner: boolean): AuthStatus {
    const base = signedIn();
    return { ...base, parentUnlockedUntil: Date.now() + 60_000, parent: base.parent ? { ...base.parent, isOwner } : null };
  }

  async function renderAccount(): Promise<HTMLElement> {
    const router = createMemoryRouter([{ path: '/parent/compte', element: <AccountPage /> }], { initialEntries: ['/parent/compte'] });
    return render(<RouterProvider router={router} />);
  }

  it('is hidden for an account that is not the owner', async () => {
    setCachedStatus(unlockedStatus(false));
    const container = await renderAccount();
    expect(container.textContent).toContain('Changer le code des réglages');
    expect(container.textContent).not.toContain('Invitations');
    expect(admin.getInvitation).not.toHaveBeenCalled();
  });

  it('lets the owner open registrations, copy, regenerate and choose the code', async () => {
    setCachedStatus(unlockedStatus(true));
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    admin.getInvitation.mockResolvedValue({ enabled: false, code: '', updatedAt: null });
    admin.updateInvitation.mockImplementation(async (body: { enabled: boolean; code?: string; regenerate?: boolean }) => ({
      enabled: body.enabled, code: body.code?.toUpperCase() ?? (body.regenerate ? 'ACDE-FGHJ-KMNP' : CODE), updatedAt: 2,
    }));
    const container = await renderAccount();
    await waitFor(() => expect(container.textContent).toContain('Seules les personnes qui connaissent ce code peuvent créer un compte.'));
    expect(container.textContent).toContain('Aucun code pour le moment.');
    expect(buttonByText('Copier', container)).toBeNull();

    const toggle = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]')).find((el) => el.textContent?.includes('Autoriser les inscriptions avec un code'));
    expect(toggle).toBeDefined();
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    await click(toggle);
    await waitFor(() => expect(container.textContent).toContain(CODE));
    expect(admin.updateInvitation).toHaveBeenLastCalledWith({ enabled: true });
    expect(toggle?.getAttribute('aria-checked')).toBe('true');

    await click(buttonByText('Copier', container));
    expect(writeText).toHaveBeenCalledWith(CODE);

    await click(buttonByText('Générer un nouveau code', container));
    await waitFor(() => expect(container.textContent).toContain('ACDE-FGHJ-KMNP'));
    expect(admin.updateInvitation).toHaveBeenLastCalledWith({ enabled: true, regenerate: true });

    const input = inputByLabel(container, 'Code personnalisé');
    await typeInto(input, 'court');
    await click(buttonByText('Utiliser ce code', container));
    await waitFor(() => expect(container.textContent).toContain('De 8 à 64 lettres, chiffres ou tirets.'));
    expect(admin.updateInvitation).toHaveBeenCalledTimes(2);

    await typeInto(input, ' mon-code-2026 ');
    await click(buttonByText('Utiliser ce code', container));
    await waitFor(() => expect(container.textContent).toContain('MON-CODE-2026'));
    expect(admin.updateInvitation).toHaveBeenLastCalledWith({ enabled: true, code: 'mon-code-2026' });
  });
});
