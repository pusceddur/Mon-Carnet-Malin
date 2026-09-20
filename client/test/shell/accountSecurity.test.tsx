// §20 account security in the app: code of the Réglages optional, devices signed in, « Mot de passe oublié », link of
// the e-mail sent every 180 days, sign-out that clears this device, device name.
import type { AuthStatus, DeviceSession } from '@aide/shared';
import { act } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { ToastProvider } from '../../src/design/components';
import { parent } from '../../src/i18n/fr/parent';
import { describeThisDevice } from '../../src/platform/deviceName';
import { isParentUnlocked, useSessionStore } from '../../src/state/session';
import { buttonByText, cleanup, click, render, waitFor } from './render';

const api = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  setPinRequired: vi.fn(),
  listDeviceSessions: vi.fn(),
  signOutDevice: vi.fn(),
  signOutOtherDevices: vi.fn(),
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
  confirmContinuity: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../../src/api/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/api/auth')>()), ...api }));
vi.mock('../../src/api/admin', () => ({ getInvitation: vi.fn(async () => ({ enabled: false, code: '', updatedAt: null })), updateInvitation: vi.fn() }));
vi.mock('../../src/sync/SyncEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/SyncEngine')>()),
  syncNow: vi.fn(async () => undefined),
}));

const AccountPage = (await import('../../src/features/parent/AccountPage')).default;
const LoginPage = (await import('../../src/features/auth/LoginPage')).default;
const { ContinuityPage, ForgotPasswordPage, ResetPasswordPage } = await import('../../src/features/auth/PasswordResetPages');

const tp = parent.account.pinRequired;
const td = parent.account.devices;
const tr = parent.passwordReset;

function status(patch: Partial<AuthStatus> = {}): AuthStatus {
  return {
    setupRequired: false, authenticated: true, pinSet: true, pinLockedUntil: null, registrationOpen: false, pinRequired: true, passwordResetAvailable: false, aiReading: false,
    parentUnlockedUntil: Date.now() + 60_000, parent: { id: 'p1', email: 'parent@example.fr', displayName: 'Alex', createdAt: 1, isOwner: false }, ...patch,
  };
}

const DEVICES: DeviceSession[] = [
  { id: 'aaaaaaaaaaaaaaaa', current: true, name: 'iPad · app installée', device: 'mac', browser: 'Safari', ip: '203.0.113.7', createdAt: Date.UTC(2026, 8, 1), lastSeenAt: Date.now() },
  { id: 'bbbbbbbbbbbbbbbb', current: false, name: null, device: 'windows', browser: 'Chrome', ip: '198.51.100.4', createdAt: Date.UTC(2026, 7, 1), lastSeenAt: Date.now() - 3 * 60 * 60_000 },
];

async function renderAt(path: string): Promise<HTMLElement> {
  const router = createMemoryRouter(
    [
      { path: '/parent/compte', element: <ToastProvider><AccountPage /></ToastProvider> },
      { path: '/connexion', element: <LoginPage /> },
      { path: '/mot-de-passe-oublie', element: <ForgotPasswordPage /> },
      { path: '/nouveau-mot-de-passe', element: <ResetPasswordPage /> },
      { path: '/confirmer', element: <ContinuityPage /> },
      { path: '/', element: <p>accueil</p> },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

/** Last field with this label (« Mot de passe du compte » is also in « Changer le code des réglages »). */
function inputByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const found = Array.from(container.querySelectorAll('label')).filter((l) => l.firstChild?.textContent?.trim() === label).at(-1);
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

function switchByText(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]')).find((el) => el.textContent?.includes(text));
  if (!found) throw new Error(`switch not found: ${text}`);
  return found;
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.clearAllMocks();
  api.listDeviceSessions.mockResolvedValue(DEVICES);
  api.getAuthStatus.mockResolvedValue(status({ authenticated: false, parent: null, parentUnlockedUntil: null }));
  useSessionStore.setState({ ready: true, online: true, refreshing: false, authStatus: status(), children: [], selectedChildId: null, parentSettings: null });
});

afterEach(async () => {
  await cleanup();
});

afterAll(() => {
  db.close();
});

describe('code of the Réglages optional', () => {
  it('the Réglages stay open without the code; the change asks for the password', async () => {
    expect(isParentUnlocked(status({ pinRequired: false, parentUnlockedUntil: null }), Date.now())).toBe(true);
    expect(isParentUnlocked(status({ pinRequired: true, parentUnlockedUntil: Date.now() - 1 }), Date.now())).toBe(false);

    api.setPinRequired.mockResolvedValue(status({ pinRequired: false }));
    const container = await renderAt('/parent/compte');
    await click(switchByText(container, tp.label));
    expect(container.textContent).toContain(tp.askOff);
    await typeInto(inputByLabel(container, tp.passwordLabel), 'motdepasse');
    await click(buttonByText(tp.confirm, container));
    await waitFor(() => expect(api.setPinRequired).toHaveBeenCalledWith({ required: false, password: 'motdepasse' }));
    await waitFor(() => expect(useSessionStore.getState().authStatus?.pinRequired).toBe(false));
    expect(switchByText(container, tp.label).getAttribute('aria-checked')).toBe('false');
    expect(container.textContent).toContain(tp.hintOff);
  });
});

describe('devices signed in', () => {
  it('lists the devices with name, last use and IP; another device or all others can be signed out', async () => {
    api.signOutDevice.mockResolvedValue({ ok: true });
    api.signOutOtherDevices.mockResolvedValue({ ok: true });
    const container = await renderAt('/parent/compte');
    await waitFor(() => expect(container.textContent).toContain('iPad · app installée'));
    expect(container.textContent).toContain(td.current);
    expect(container.textContent).toContain('Ordinateur Windows · Chrome');
    expect(container.textContent).toContain('198.51.100.4');
    expect(container.textContent).toContain('il y a 3 heures');

    await click(container.querySelector(`button[aria-label="${`Déconnecter « Ordinateur Windows · Chrome »`}"]`));
    await waitFor(() => expect(api.signOutDevice).toHaveBeenCalledWith('bbbbbbbbbbbbbbbb'));
    await click(buttonByText(td.signOutOthers, container));
    await waitFor(() => expect(api.signOutOtherDevices).toHaveBeenCalledTimes(1));
  });

  it('names this device in a way the server cannot guess (an iPad in Safari looks like a Mac)', () => {
    const ipadSafari = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', maxTouchPoints: 5 };
    expect(describeThisDevice({ navigator: ipadSafari, native: false, standalone: false })).toBe('iPad · Safari');
    expect(describeThisDevice({ navigator: ipadSafari, native: false, standalone: true })).toBe('iPad · app installée');
    expect(describeThisDevice({ navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36' }, native: false, standalone: false }))
      .toBe('Ordinateur Windows · Chrome');
  });
});

describe('sign-out', () => {
  it('clears the family’s books and notes from this device by default', async () => {
    api.logout.mockResolvedValue({ ok: true });
    await db.documents.put({ id: 'd1' } as never);
    const forget = vi.spyOn(useSessionStore.getState(), 'forgetThisDevice');
    const container = await renderAt('/parent/compte');
    await click(buttonByText(parent.account.logout.button, container));
    expect(switchByText(document.body, parent.account.logout.wipeLabel).getAttribute('aria-checked')).toBe('true');
    // The confirmation button of the dialog comes after the one that opened it (same label).
    await click(Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent?.trim() === parent.account.logout.confirm).at(-1));
    await waitFor(() => expect(api.logout).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await db.documents.count()).toBe(0));
    expect(forget).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useSessionStore.getState().authStatus?.authenticated).toBe(false));
  });
});

describe('« Mot de passe oublié » and the link of the e-mail', () => {
  it('the login page offers it only when the server can send e-mails; the request always ends with the same message', async () => {
    useSessionStore.setState({ authStatus: status({ authenticated: false, parent: null, parentUnlockedUntil: null, passwordResetAvailable: false }) });
    const without = await renderAt('/connexion');
    expect(buttonByText(parent.login.forgotLink, without)).toBeNull();
    await cleanup();

    const available = status({ authenticated: false, parent: null, parentUnlockedUntil: null, passwordResetAvailable: true });
    api.getAuthStatus.mockResolvedValue(available);
    useSessionStore.setState({ authStatus: available });
    const login = await renderAt('/connexion');
    await click(buttonByText(parent.login.forgotLink, login));
    api.requestPasswordReset.mockResolvedValue({ ok: true });
    await waitFor(() => expect(login.textContent).toContain(tr.intro));
    await typeInto(inputByLabel(login, tr.emailLabel), ' parent@example.fr ');
    await click(buttonByText(tr.submit, login));
    await waitFor(() => expect(login.textContent).toContain(tr.sent));
    expect(api.requestPasswordReset).toHaveBeenCalledWith({ email: 'parent@example.fr' });
  });

  it('the new password needs the code of the Réglages; a link without its token asks for a new link', async () => {
    const missing = await renderAt('/nouveau-mot-de-passe');
    expect(missing.textContent).toContain(tr.missingLink);
    await cleanup();

    api.confirmPasswordReset.mockResolvedValue({ ok: true });
    const token = 'T'.repeat(43);
    const container = await renderAt(`/nouveau-mot-de-passe?jeton=${token}`);
    await typeInto(inputByLabel(container, tr.pinLabel), '4829a13');
    await typeInto(inputByLabel(container, tr.passwordLabel), 'nouveau-mot-de-passe-1');
    await typeInto(inputByLabel(container, tr.confirmLabel), 'nouveau-mot-de-passe-1');
    await click(buttonByText(tr.newSubmit, container));
    await waitFor(() => expect(container.textContent).toContain(tr.done));
    expect(api.confirmPasswordReset).toHaveBeenCalledWith({ token, pin: '482913', newPassword: 'nouveau-mot-de-passe-1' });
  });

  it('the link of the e-mail sent every 180 days confirms the use', async () => {
    api.confirmContinuity.mockResolvedValue({ ok: true });
    const token = 'C'.repeat(43);
    const container = await renderAt(`/confirmer?jeton=${token}`);
    await click(buttonByText(parent.continuity.submit, container));
    await waitFor(() => expect(container.textContent).toContain(parent.continuity.done));
    expect(api.confirmContinuity).toHaveBeenCalledWith({ token });
  });
});
