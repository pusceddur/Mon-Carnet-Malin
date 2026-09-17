// Minimal DOM test helpers (react-dom + act, no external testing library).
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots = new Set<{ root: Root; container: HTMLElement }>();

export async function render(ui: ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.add({ root, container });
  await act(async () => {
    root.render(ui);
  });
  return container;
}

export async function cleanup(): Promise<void> {
  for (const entry of Array.from(roots)) {
    roots.delete(entry);
    await act(async () => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
  document.body.innerHTML = '';
}

export async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Retries `check` inside act until it passes (async effects, lazy routes, Dexie live queries). */
export async function waitFor(check: () => void, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error;
      await flush(20);
    }
  }
}

export async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('click: element not found');
  await act(async () => {
    element.click();
  });
}

export function buttonByText(text: string, root: ParentNode = document): HTMLButtonElement | null {
  return (
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => {
      const name = (b.getAttribute('aria-label') ?? b.textContent ?? '').trim();
      const label = b.querySelector('.ui-btn__label')?.textContent?.trim();
      return name === text || (b.textContent ?? '').trim() === text || label === text;
    }) ?? null
  );
}
