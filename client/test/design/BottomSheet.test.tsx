import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BottomSheet, Button } from '../../src/design/components';
import { shouldDismissSwipe, sheetDragOffset } from '../../src/design/components/internal/swipe';
import { common } from '../../src/i18n/fr/common';
import { buttonByName, byRole, cleanup, click, keyDown, pointer, render, wait } from './render';

const EXIT_WAIT_MS = 260;

function Harness({ onClose, dismissible = true }: { onClose?: () => void; dismissible?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Ouvrir</Button>
      <BottomSheet
        open={open}
        title="Définition"
        dismissible={dismissible}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        footer={<Button onClick={() => setOpen(false)}>Terminé</Button>}
      >
        <p>La photosynthèse permet aux plantes de fabriquer leur nourriture.</p>
        <button type="button">Écouter</button>
      </BottomSheet>
    </>
  );
}

describe('BottomSheet', () => {
  afterEach(cleanup);

  it('opens as a labelled modal dialog, moves focus inside and makes the background inert', async () => {
    const { container } = await render(<Harness />);
    expect(byRole('dialog')).toBeNull();

    const opener = buttonByName('Ouvrir');
    opener?.focus();
    await click(opener);

    const dialog = byRole('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog?.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent).toBe('Définition');
    expect(dialog?.contains(document.activeElement)).toBe(true);
    expect(container.hasAttribute('inert')).toBe(true);
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('closes with the close button, then unmounts, restores focus and background', async () => {
    const onClose = vi.fn();
    const { container } = await render(<Harness onClose={onClose} />);
    const opener = buttonByName('Ouvrir');
    opener?.focus();
    await click(opener);

    await click(buttonByName(common.close, byRole('dialog') ?? document));
    expect(onClose).toHaveBeenCalledTimes(1);

    await wait(EXIT_WAIT_MS);
    expect(byRole('dialog')).toBeNull();
    expect(container.hasAttribute('inert')).toBe(false);
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.activeElement).toBe(opener);
  });

  it('closes with Escape and with a tap on the overlay', async () => {
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} />);

    await click(buttonByName('Ouvrir'));
    await keyDown(document, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    await wait(EXIT_WAIT_MS);

    await click(buttonByName('Ouvrir'));
    await click(document.querySelector('.ui-layer__overlay'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes on a long swipe down on the handle area, not on a short one', async () => {
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} />);
    await click(buttonByName('Ouvrir'));
    const grab = document.querySelector('.ui-sheet__grab');

    await pointer(grab, 'pointerdown', { clientY: 100 });
    await pointer(grab, 'pointermove', { clientY: 110 });
    expect((byRole('dialog') as HTMLElement).style.transform).toContain('10px');
    await wait(40);
    await pointer(grab, 'pointerup', { clientY: 112 });
    expect(onClose).not.toHaveBeenCalled();
    expect((byRole('dialog') as HTMLElement).style.transform).toBe('');

    await pointer(grab, 'pointerdown', { clientY: 100 });
    await pointer(grab, 'pointermove', { clientY: 260 });
    await pointer(grab, 'pointerup', { clientY: 300 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab focus inside the sheet', async () => {
    await render(<Harness />);
    await click(buttonByName('Ouvrir'));
    const dialog = byRole('dialog') as HTMLElement;
    const buttons = Array.from(dialog.querySelectorAll('button'));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    last?.focus();
    await keyDown(last as HTMLElement, 'Tab');
    expect(document.activeElement).toBe(first);
    await keyDown(first as HTMLElement, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('non-dismissible sheet ignores Escape and overlay and has no close button', async () => {
    const onClose = vi.fn();
    await render(<Harness onClose={onClose} dismissible={false} />);
    await click(buttonByName('Ouvrir'));
    await keyDown(document, 'Escape');
    await click(document.querySelector('.ui-layer__overlay'));
    expect(onClose).not.toHaveBeenCalled();
    expect(buttonByName(common.close, byRole('dialog') ?? document)).toBeNull();
  });
});

describe('swipe rules', () => {
  it('dismisses after a distance or a fast flick', () => {
    expect(shouldDismissSwipe(130, 800, 600)).toBe(true);
    expect(shouldDismissSwipe(60, 800, 600)).toBe(false);
    expect(shouldDismissSwipe(60, 50, 600)).toBe(true);
    expect(shouldDismissSwipe(20, 10, 600)).toBe(false);
    expect(shouldDismissSwipe(-200, 50, 600)).toBe(false);
    // short sheet: a quarter of its height is enough
    expect(shouldDismissSwipe(55, 900, 200)).toBe(true);
    expect(shouldDismissSwipe(Number.NaN, 10, 200)).toBe(false);
  });

  it('only drags downwards', () => {
    expect(sheetDragOffset(42)).toBe(42);
    expect(sheetDragOffset(-30)).toBe(0);
    expect(sheetDragOffset(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
