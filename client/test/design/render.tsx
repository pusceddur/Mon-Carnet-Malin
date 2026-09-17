// Minimal DOM test helpers (react-dom + act, no external testing library).
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  container: HTMLElement;
  rerender(ui: ReactElement): Promise<void>;
  unmount(): Promise<void>;
}

const roots = new Set<{ root: Root; container: HTMLElement }>();

export async function render(ui: ReactElement): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const entry = { root, container };
  roots.add(entry);
  await act(async () => {
    root.render(ui);
  });
  return {
    container,
    rerender: async (next) => {
      await act(async () => {
        root.render(next);
      });
    },
    unmount: async () => {
      if (!roots.has(entry)) return;
      roots.delete(entry);
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Unmounts everything rendered by `render` and empties the body. */
export async function cleanup(): Promise<void> {
  for (const entry of Array.from(roots)) {
    roots.delete(entry);
    await act(async () => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
  document.body.innerHTML = '';
  document.documentElement.style.overflow = '';
}

export async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('click: element not found');
  await act(async () => {
    element.click();
  });
}

export async function keyDown(target: EventTarget, key: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}

export async function pointer(
  element: Element | null | undefined,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: PointerEventInit = {},
): Promise<void> {
  if (!element) throw new Error(`${type}: element not found`);
  await act(async () => {
    element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', ...init }));
  });
}

export async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

export function byRole(role: string, root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[role="${role}"]`);
}

export function allByRole(role: string, root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[role="${role}"]`));
}

/** First button whose accessible name (aria-label or text) equals `name`. */
export function buttonByName(name: string, root: ParentNode = document): HTMLButtonElement | null {
  return (
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === name,
    ) ?? null
  );
}
