import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, ConfirmDialog, OfflineBadge, ToastProvider, useToast, type ToastApi } from '../../src/design/components';
import { common } from '../../src/i18n/fr/common';
import { buttonByName, byRole, cleanup, click, keyDown, render, wait } from './render';

describe('ToastProvider / useToast', () => {
  afterEach(cleanup);

  function Capture({ onApi }: { onApi: (api: ToastApi) => void }): null {
    onApi(useToast());
    return null;
  }

  async function renderWithApi(): Promise<ToastApi> {
    let api: ToastApi | null = null;
    await render(
      <ToastProvider>
        <Capture onApi={(a) => (api = a)} />
      </ToastProvider>,
    );
    if (!api) throw new Error('no api');
    return api;
  }

  function messages(): string[] {
    return Array.from(document.querySelectorAll('.ui-toast__message')).map((el) => el.textContent ?? '');
  }

  it('shows messages in a polite live region, without duplicates', async () => {
    const api = await renderWithApi();
    const region = document.querySelector('.ui-toasts');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.parentElement?.hasAttribute('data-ui-persistent')).toBe(true);

    const first = api.success('Livre enregistré');
    await wait(0);
    const again = api.success('Livre enregistré');
    await wait(0);
    expect(again).toBe(first);
    expect(messages()).toEqual(['Livre enregistré']);
    expect(document.querySelector('.ui-toast--success')).not.toBeNull();
  });

  it('closes on the close button and runs the action', async () => {
    const api = await renderWithApi();
    const action = vi.fn();
    api.show({ message: 'Pas de connexion', tone: 'warning', durationMs: null, action: { label: common.retry, onClick: action } });
    await wait(0);
    await click(buttonByName(common.retry));
    expect(action).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual([]);

    api.error('Oups');
    await wait(0);
    await click(buttonByName(common.toast.dismiss));
    expect(messages()).toEqual([]);
  });

  it('dismisses automatically and keeps at most 3 toasts', async () => {
    const api = await renderWithApi();
    api.show({ message: 'Court', durationMs: 30 });
    await wait(0);
    expect(messages()).toEqual(['Court']);
    await wait(60);
    expect(messages()).toEqual([]);

    for (const m of ['Un', 'Deux', 'Trois', 'Quatre']) api.info(m);
    await wait(0);
    expect(messages()).toEqual(['Deux', 'Trois', 'Quatre']);
  });

  it('is a silent no-op outside the provider', async () => {
    let api: ToastApi | null = null;
    await render(<Capture onApi={(a) => (api = a)} />);
    expect(() => (api as ToastApi | null)?.error('Rien')).not.toThrow();
    expect(document.querySelector('.ui-toast')).toBeNull();
  });
});

describe('ConfirmDialog', () => {
  afterEach(cleanup);

  function DeleteBook({ onConfirm, onCancel }: { onConfirm: () => void | Promise<void>; onCancel: () => void }): JSX.Element {
    const [open, setOpen] = useState(true);
    return (
      <ConfirmDialog
        open={open}
        tone="danger"
        title="Supprimer ce livre ?"
        message="Les notes de ce livre seront aussi supprimées."
        confirmLabel={common.delete}
        onConfirm={onConfirm}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
      />
    );
  }

  it('is an alertdialog that focuses Cancel first for destructive actions', async () => {
    await render(<DeleteBook onConfirm={() => {}} onCancel={() => {}} />);
    const dialog = byRole('alertdialog') as HTMLElement;
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Les notes de ce livre seront aussi supprimées.',
    );
    expect(document.activeElement).toBe(buttonByName(common.cancel, dialog));
  });

  it('confirms, and blocks dismissal while the async confirmation runs', async () => {
    let finish: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onCancel = vi.fn();
    await render(<DeleteBook onConfirm={onConfirm} onCancel={onCancel} />);

    const confirm = buttonByName(common.delete);
    await click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm?.getAttribute('aria-busy')).toBe('true');
    await click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await keyDown(document, 'Escape');
    expect(onCancel).not.toHaveBeenCalled();

    finish();
    await wait(0);
    expect(confirm?.hasAttribute('aria-busy')).toBe(false);
    await keyDown(document, 'Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('OfflineBadge', () => {
  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it('appears when the browser goes offline and hides when back online', async () => {
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    const view = await render(
      <div>
        <OfflineBadge />
        <Button>Lire</Button>
      </div>,
    );
    expect(view.container.querySelector('.ui-offline')).toBeNull();

    onLine.mockReturnValue(false);
    await wait(0);
    window.dispatchEvent(new Event('offline'));
    await wait(0);
    expect(view.container.querySelector('.ui-offline')?.textContent).toBe(common.offline);

    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await wait(0);
    expect(view.container.querySelector('.ui-offline')).toBeNull();
  });
});
