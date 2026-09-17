import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from 'react';
import { reader } from '../../i18n/fr/reader';

/** What the band covers. `resolve` is called again at every measure: the element may be re-rendered. */
export interface GuideAnchor {
  /** Same key = same reading position (a sentence being read, a tapped word): a band moved by hand stays put. */
  key: string;
  resolve(): Element | null;
  /** 'first': the first line of the element (word being read, tapped word); 'all': every line of the element (sentence). */
  lines: 'first' | 'all';
  /** true: the band stays on the element while the page scrolls (voice reading); false: the band moves once, then stays put. */
  follow: boolean;
}

export interface ReadingGuideProps {
  /** Height of one reading line in px. */
  lineHeightPx: number;
  anchor: GuideAnchor | null;
}

export interface GuideRect { top: number; bottom: number }
export interface GuideBand { top: number; height: number }

const KEY_STEP_LINES = 1;
/** Frames during which a new position is measured again (fonts, layout and page turns settle). */
const SETTLE_FRAMES = 30;

export function clampGuideTop(top: number, bandHeight: number, viewportHeight: number): number {
  return Math.min(Math.max(0, viewportHeight - bandHeight), Math.max(0, top));
}

/** Line boxes of an inline element, in viewport coordinates (empty fragments at line ends are ignored). */
export function measureGuideTarget(element: Element, lines: GuideAnchor['lines']): (GuideRect & { lineHeight: number }) | null {
  if (!element.isConnected) return null;
  const rects = Array.from(element.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0);
  if (rects.length === 0) {
    const box = element.getBoundingClientRect();
    if (box.height <= 0) return null;
    return { top: box.top, bottom: box.bottom, lineHeight: box.height };
  }
  const lineHeight = Math.min(...rects.map((r) => r.height));
  if (lines === 'first') return { top: rects[0]!.top, bottom: rects[0]!.bottom, lineHeight };
  return { top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)), lineHeight };
}

/** Band around the measured lines: at least one reading line, centred on the text, inside the viewport. */
export function guideBandFor(rect: GuideRect & { lineHeight: number }, lineBand: number, viewportHeight: number): GuideBand {
  const padding = Math.max(0, lineBand - rect.lineHeight);
  const height = Math.round(Math.min(viewportHeight, Math.max(lineBand, rect.bottom - rect.top + padding)));
  const center = (rect.top + rect.bottom) / 2;
  return { top: Math.round(clampGuideTop(center - height / 2, height, viewportHeight)), height };
}

/** Reading ruler: a clear band over the line being read, the rest slightly dimmed; drag the side handle to move it. */
export function ReadingGuide({ lineHeightPx, anchor }: ReadingGuideProps): JSX.Element {
  const lineBand = Math.max(32, Math.round(lineHeightPx * 1.3));
  const [band, setBand] = useState<GuideBand>(() => ({
    top: Math.round((typeof window === 'undefined' ? 600 : window.innerHeight) * 0.4),
    height: lineBand,
  }));
  const drag = useRef<{ pointerId: number; offset: number } | null>(null);
  /** Key of the anchor moved away by hand: not followed any more until the next position. */
  const manualKey = useRef<string | null>(null);
  const settledKey = useRef<string | null>(null);

  useEffect(() => {
    if (!anchor) {
      setBand((prev) => (prev.height === lineBand ? prev : { top: clampGuideTop(prev.top + (prev.height - lineBand) / 2, lineBand, window.innerHeight), height: lineBand }));
      return undefined;
    }
    const place = (): void => {
      if (manualKey.current === anchor.key) return;
      const element = anchor.resolve();
      const rect = element ? measureGuideTarget(element, anchor.lines) : null;
      if (!rect) return;
      const next = guideBandFor(rect, lineBand, window.innerHeight);
      setBand((prev) => (prev.top === next.top && prev.height === next.height ? prev : next));
    };
    place();
    if (!anchor.follow) return undefined;

    // A new position (sentence, page turn): measured again while the layout settles; word changes only need one measure.
    let frames = settledKey.current === anchor.key ? SETTLE_FRAMES : 0;
    settledKey.current = anchor.key;
    let raf = frames < SETTLE_FRAMES ? requestAnimationFrame(function settle() {
      place();
      if (++frames < SETTLE_FRAMES) raf = requestAnimationFrame(settle);
    }) : 0;
    const options = { capture: true, passive: true } as const;
    // Scroll events also fire during the smooth scroll that brings the sentence into view.
    window.addEventListener('scroll', place, options);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', place, options);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [anchor, lineBand]);

  /** Moving by hand: back to one line, centred where the band was, and the voice is not followed until its next sentence. */
  const moveTo = (top: number): void => {
    manualKey.current = anchor?.key ?? null;
    setBand({ top: clampGuideTop(top, lineBand, window.innerHeight), height: lineBand });
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    const top = band.top + (band.height - lineBand) / 2;
    moveTo(top);
    drag.current = { pointerId: event.pointerId, offset: event.clientY - top };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released.
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) return;
    moveTo(event.clientY - drag.current.offset);
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveTo(band.top + (band.height - lineBand) / 2 + (event.key === 'ArrowUp' ? -1 : 1) * lineHeightPx * KEY_STEP_LINES);
    }
  };

  const { top, height } = band;
  return (
    <div className="rd-guide">
      <div className="rd-guide__shade" style={{ top: 0, height: top }} aria-hidden="true" />
      <div className="rd-guide__band" style={{ top, height }} aria-hidden="true" />
      <div className="rd-guide__shade" style={{ top: top + height, bottom: 0 }} aria-hidden="true" />
      <button
        type="button"
        className="rd-guide__handle"
        style={{ top: top + height / 2 }}
        aria-label={reader.guide.handle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <span aria-hidden="true">↕</span>
      </button>
    </div>
  );
}
