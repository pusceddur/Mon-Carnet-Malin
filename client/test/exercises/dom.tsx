// Small DOM helpers for the exercises screens (react-dom + act, no testing library).
import { DEFAULT_PARENT_SETTINGS, type AuthStatus, type ChildProfile, type ParentSettings } from '@aide/shared';
import { act, type JSX, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { db } from '../../src/db/localDb';
import { useSessionStore } from '../../src/state/session';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; container: HTMLElement } | null = null;

export async function renderAt(path: string, routes: { path: string; element: ReactElement }[]): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container;
}

/** Shows where the app navigated (for routes outside the exercises area). */
export function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

export async function cleanup(): Promise<void> {
  if (mounted) {
    const { root, container } = mounted;
    mounted = null;
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  document.body.innerHTML = '';
}

export async function resetDb(): Promise<void> {
  await Promise.all(db.tables.map((table) => table.clear()));
}

export function setSession(child: ChildProfile, settings: ParentSettings = DEFAULT_PARENT_SETTINGS): void {
  const authStatus: AuthStatus = {
    setupRequired: false, authenticated: true, parent: null, parentUnlockedUntil: null, pinSet: true, pinLockedUntil: null,
    registrationOpen: false, pinRequired: true, passwordResetAvailable: false, aiReading: false,
  };
  useSessionStore.setState({ authStatus, selectedChildId: child.id, children: [child], parentSettings: settings });
}

export async function wait(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Polls until `find` returns a value (Dexie live queries resolve asynchronously). */
export async function waitFor<T>(find: () => T | null | undefined | false, timeoutMs = 2000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = find();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() - started > timeoutMs) throw new Error('waitFor: timed out');
    await wait(10);
  }
}

/** Async variant of waitFor (for Dexie reads). */
export async function waitForAsync(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('waitForAsync: timed out');
    await wait(10);
  }
}

function accessibleName(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label !== null) return label.trim();
  const inner = el.querySelector('.ui-btn__label');
  return (inner?.textContent ?? el.textContent ?? '').trim();
}

export function buttons(root: ParentNode = document): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
}

/** Button whose aria-label, visible label or text contains `name`. */
export function button(name: string, root: ParentNode = document): HTMLButtonElement | null {
  return buttons(root).find((b) => accessibleName(b) === name) ?? buttons(root).find((b) => (b.textContent ?? '').includes(name)) ?? null;
}

export async function click(el: Element | null | undefined): Promise<void> {
  if (!(el instanceof HTMLElement)) throw new Error('click: element not found');
  await act(async () => {
    el.click();
  });
}

export async function clickButton(name: string): Promise<void> {
  const el = await waitFor(() => button(name));
  await click(el);
}

export async function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string): Promise<void> {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export function text(root: ParentNode = document): string {
  const node = root === document ? document.body : (root as Element);
  return node.textContent ?? '';
}

export async function waitForText(fragment: string, timeoutMs = 2000): Promise<void> {
  await waitFor(() => text().includes(fragment), timeoutMs);
}

export function location(): string {
  return document.querySelector('[data-testid="location"]')?.textContent ?? '';
}
