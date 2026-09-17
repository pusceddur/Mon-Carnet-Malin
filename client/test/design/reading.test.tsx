import { DEFAULT_READING_PREFERENCES } from '@aide/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyState, PageHeader, Tile } from '../../src/design/components';
import { whenFontsReady } from '../../src/design/fonts';
import { applyTheme, readingFontClass, readingStyleVars, THEME_PAPER } from '../../src/design/reading';
import UnsupportedBrowserPage from '../../src/features/system/UnsupportedBrowserPage';
import { common } from '../../src/i18n/fr/common';
import { FEATURE_INDEXEDDB, FEATURE_WEBASSEMBLY } from '../../src/platform/support';
import { buttonByName, cleanup, click, render } from './render';

describe('reading helpers', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.head.innerHTML = '';
  });

  it('maps fonts to classes', () => {
    expect(readingFontClass('opendyslexic')).toBe('read-font-opendyslexic');
    expect(readingFontClass('systeme')).toBe('read-font-systeme');
    expect(readingFontClass('inconnue' as never)).toBe('read-font-lexend');
  });

  it('builds the reading custom properties from the defaults', () => {
    expect(readingStyleVars(DEFAULT_READING_PREFERENCES)).toEqual({
      '--read-size': '24px',
      '--read-line-height': '1.8',
      '--read-letter-spacing': '0.04em',
      '--read-word-spacing': '0.16em',
      '--read-column': '30em',
    });
  });

  it('clamps out-of-range and invalid preferences', () => {
    const vars = readingStyleVars({ fontSizePx: 90, lineHeight: 0.5, letterSpacingEm: Number.NaN, wordSpacingEm: -1, columnWidthEm: 1000 });
    expect(vars).toEqual({
      '--read-size': '44px',
      '--read-line-height': '1.2',
      '--read-letter-spacing': '0.04em',
      '--read-word-spacing': '0em',
      '--read-column': '48em',
    });
  });

  it('applies a theme to the root and the browser chrome colour', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);

    applyTheme('sombre');
    expect(document.documentElement.getAttribute('data-theme')).toBe('sombre');
    expect(meta.content).toBe(THEME_PAPER.sombre);

    applyTheme(null);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect([THEME_PAPER.creme, THEME_PAPER.sombre]).toContain(meta.content);

    const reader = document.createElement('article');
    applyTheme('clair', reader);
    expect(reader.getAttribute('data-theme')).toBe('clair');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('waits for fonts when the Font Loading API exists', async () => {
    const ready = vi.fn();
    await whenFontsReady({ fonts: { ready: Promise.resolve().then(ready) } });
    expect(ready).toHaveBeenCalled();
    await expect(whenFontsReady({})).resolves.toBeUndefined();
    await expect(whenFontsReady({ fonts: { ready: Promise.reject(new Error('x')) } })).resolves.toBeUndefined();
  });
});

describe('layout components', () => {
  afterEach(cleanup);

  it('Tile exposes its label as the button name and hides the emoji', async () => {
    const onClick = vi.fn();
    const view = await render(<Tile emoji="📚" label="Mes livres" description="3 livres" onClick={onClick} />);
    const button = view.container.querySelector('button') as HTMLButtonElement;
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('📚');
    expect(button.textContent).toContain('Mes livres');
    await click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('PageHeader renders an h1 and a visible back button', async () => {
    const onBack = vi.fn();
    const view = await render(<PageHeader title="Mes notes" onBack={onBack} />);
    expect(view.container.querySelector('h1')?.textContent).toBe('Mes notes');
    await click(buttonByName(common.back));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('EmptyState renders title, message and action', async () => {
    const view = await render(<EmptyState emoji="📚" title="Pas encore de livre" message="Demande à un adulte d’en ajouter un." />);
    expect(view.container.querySelector('h2')?.textContent).toBe('Pas encore de livre');
    expect(view.container.textContent).toContain('Demande à un adulte');
  });
});

describe('UnsupportedBrowserPage', () => {
  afterEach(cleanup);

  it('explains how to update and lists the missing features', async () => {
    const view = await render(<UnsupportedBrowserPage missing={[FEATURE_INDEXEDDB]} />);
    expect(view.container.querySelector('h1')?.textContent).toBe(common.unsupported.title);
    expect(view.container.textContent).toContain(common.unsupported.stepUpdate);
    expect(view.container.textContent).not.toContain(common.unsupported.stepLockdown);
    expect(view.container.querySelector('details')?.textContent).toContain(FEATURE_INDEXEDDB);
    expect(document.title).toContain(common.unsupported.documentTitle);
  });

  it('mentions Lockdown Mode when WebAssembly is missing', async () => {
    const view = await render(<UnsupportedBrowserPage missing={[FEATURE_WEBASSEMBLY]} />);
    expect(view.container.textContent).toContain(common.unsupported.stepLockdown);
  });
});
