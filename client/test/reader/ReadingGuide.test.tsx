import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guideBandFor, measureGuideTarget, ReadingGuide, type GuideAnchor } from '../../src/features/reader/ReadingGuide';
import { cleanup, render } from '../design/render';

const rect = (top: number, height: number, width = 100): DOMRect =>
  ({ top, bottom: top + height, height, width, left: 0, right: width, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

/** An inline element whose line boxes are `lines` (moved by `offset.y` to simulate scrolling). */
function textLines(lines: [top: number, height: number][], offset = { y: 0 }): HTMLElement {
  const el = document.createElement('span');
  document.body.appendChild(el);
  el.getClientRects = () => lines.map(([top, height]) => rect(top - offset.y, height)) as unknown as DOMRectList;
  el.getBoundingClientRect = () => rect(lines[0]![0] - offset.y, lines.at(-1)![0] + lines.at(-1)![1] - lines[0]![0]);
  return el;
}

function band(): { top: number; height: number } {
  const el = document.querySelector<HTMLElement>('.rd-guide__band')!;
  return { top: parseFloat(el.style.top), height: parseFloat(el.style.height) };
}

describe('reading guide geometry', () => {
  it('measures the first line or every line of an element, ignoring empty fragments', () => {
    const el = textLines([[100, 30], [140, 0], [150, 30], [200, 30]]);
    expect(measureGuideTarget(el, 'first')).toEqual({ top: 100, bottom: 130, lineHeight: 30 });
    expect(measureGuideTarget(el, 'all')).toEqual({ top: 100, bottom: 230, lineHeight: 30 });
    el.remove();
    expect(measureGuideTarget(el, 'all')).toBeNull();
  });

  it('centres a band of at least one reading line on the text, inside the viewport', () => {
    expect(guideBandFor({ top: 100, bottom: 130, lineHeight: 30 }, 50, 1000)).toEqual({ top: 90, height: 50 });
    // Three lines: the band grows to cover the whole sentence.
    expect(guideBandFor({ top: 100, bottom: 230, lineHeight: 30 }, 50, 1000)).toEqual({ top: 90, height: 150 });
    expect(guideBandFor({ top: 990, bottom: 1020, lineHeight: 30 }, 50, 1000)).toEqual({ top: 950, height: 50 });
  });
});

describe('ReadingGuide', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
  });
  afterEach(async () => {
    await cleanup();
    document.body.innerHTML = '';
  });

  it('keeps the sentence being read inside the band while the page scrolls', async () => {
    const offset = { y: 0 };
    const sentence = textLines([[600, 30], [650, 30]], offset);
    const anchor: GuideAnchor = { key: 'voice:a', resolve: () => sentence, lines: 'all', follow: true };
    await render(<ReadingGuide lineHeightPx={40} anchor={anchor} />);
    expect(band()).toEqual({ top: 589, height: 102 });

    // Smooth scroll towards the middle of the screen: the band follows the text.
    offset.y = 250;
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(band()).toEqual({ top: 339, height: 102 });
  });

  it('moves to the line of the word being read', async () => {
    const offset = { y: 0 };
    const first = textLines([[300, 30]], offset);
    const second = textLines([[350, 30]], offset);
    const { rerender } = await render(<ReadingGuide lineHeightPx={40} anchor={{ key: 'voice:a', resolve: () => first, lines: 'first', follow: true }} />);
    expect(band().top).toBe(289);
    await rerender(<ReadingGuide lineHeightPx={40} anchor={{ key: 'voice:a', resolve: () => second, lines: 'first', follow: true }} />);
    expect(band()).toEqual({ top: 339, height: 52 });
  });

  it('stays where a tapped word was when the page scrolls', async () => {
    const offset = { y: 0 };
    const word = textLines([[400, 30]], offset);
    await render(<ReadingGuide lineHeightPx={40} anchor={{ key: 'tap:1', resolve: () => word, lines: 'first', follow: false }} />);
    expect(band().top).toBe(389);
    offset.y = 200;
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(band().top).toBe(389);
  });

  it('stops following the voice after a manual move, until the next sentence', async () => {
    const offset = { y: 0 };
    const sentence = textLines([[500, 30]], offset);
    const anchor: GuideAnchor = { key: 'voice:a', resolve: () => sentence, lines: 'first', follow: true };
    const { rerender } = await render(<ReadingGuide lineHeightPx={40} anchor={anchor} />);
    const handle = document.querySelector<HTMLButtonElement>('.rd-guide__handle')!;
    await act(async () => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(band().top).toBe(529);
    offset.y = 100;
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(band().top).toBe(529);

    const next = textLines([[700, 30]]);
    await rerender(<ReadingGuide lineHeightPx={40} anchor={{ key: 'voice:b', resolve: () => next, lines: 'first', follow: true }} />);
    expect(band().top).toBe(689);
  });
});
