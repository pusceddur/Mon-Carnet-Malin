import type { Id, LayoutMode, PageContent, ReadingPreferences, TextHighlight } from '@aide/shared';
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type JSX, type PointerEvent, type RefObject } from 'react';
import { watchAiReading } from '../../documents/aiReadingWatch';
import { PageStatusNotice, pageNoticeKind } from '../../documents/PageStatusNotice';
import { readingFontClass, readingStyleVars } from '../../design/reading';
import { format } from '../../i18n/fr';
import { reader } from '../../i18n/fr/reader';
import { InkLayer, reanchor, type ReaderMode } from '../../pencil';
import {
  applyBlockHighlights,
  applySpeakingSentence,
  applyWordRangeClass,
  QUOTE_CLASS,
  rangeFromNativeSelection,
  SEL_CLASS,
  SPEAKING_WORD_CLASS,
  sentenceElementAt,
  wordElementFromPoint,
  wordPosition,
} from './decorations';
import { hasReadingAids, readingAidClasses, readingAidsOf } from './aids';
import { ReaderBlock } from './ReaderBlock';
import { highlightColorsForBlock, isReadable, resolveHighlights, type PageModel, type TextRange } from './model';

export interface WordTap { pageIndex: number; blockIndex: number; offset: number; element: HTMLElement }
export interface SpeakingPosition { pageIndex: number; blockIndex: number; sentenceIndex: number }

export interface ReaderTextProps {
  documentId: Id;
  childId: Id;
  pageCount: number;
  models: ReadonlyMap<number, PageModel>;
  layoutMode: LayoutMode;
  currentPage: number;
  reading: ReadingPreferences;
  layoutKey: string;
  mode: ReaderMode;
  highlights: readonly TextHighlight[];
  selection: TextRange | null;
  quote: TextRange | null;
  speaking: SpeakingPosition | null;
  /** Word being read (boundary events), block offsets. */
  speakingWord: TextRange | null;
  showSpeaking: boolean;
  /** Scroll the sentence being read into view when it changes. */
  followSpeaking: boolean;
  freeSelection: boolean;
  articleRef: RefObject<HTMLElement | null>;
  onWordTap(tap: WordTap): void;
  onBackgroundTap(): void;
  onNativeSelection(range: TextRange): void;
  onVisiblePage(pageIndex: number): void;
}

const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 600;
const NATIVE_SELECTION_DEBOUNCE_MS = 400;

function supportsContentVisibility(): boolean {
  try {
    return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('content-visibility', 'auto');
  } catch {
    return false;
  }
}

function pendingPage(documentId: Id, pageIndex: number): PageContent {
  return {
    documentId, pageIndex, status: 'pending', textSource: null, blocks: [], confidence: null, contentHash: null, width: null, height: null,
    warnings: [], updatedAt: 0,
  };
}

function scrollBehavior(): ScrollBehavior {
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduced ? 'auto' : 'smooth';
}

/** Scrolls an element to the middle of the viewport only when it is outside the comfortable reading zone. */
export function scrollIntoComfortZone(element: Element): void {
  const rect = element.getBoundingClientRect();
  const height = window.innerHeight;
  if (rect.top >= height * 0.15 && rect.bottom <= height * 0.7) return;
  if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
}

interface SectionProps {
  documentId: Id;
  childId: Id;
  pageIndex: number;
  model: PageModel | undefined;
  highlights: readonly TextHighlight[];
  layoutKey: string;
  contentVisibility: boolean;
  /** §26: the letters carry the marks of the reading aids. */
  coded: boolean;
}

const ReaderPageSection = memo(function ReaderPageSection({ documentId, childId, pageIndex, model, highlights, layoutKey, contentVisibility, coded }: SectionProps): JSX.Element {
  const sectionRef = useRef<HTMLElement | null>(null);
  const readable = model !== undefined && isReadable(model);
  const pageHighlights = useMemo(() => highlights.filter((h) => h.pageIndex === pageIndex), [highlights, pageIndex]);
  const resolved = useMemo(() => (model && readable ? resolveHighlights(model, pageHighlights, reanchor) : []), [model, readable, pageHighlights]);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section || !model) return;
    for (const block of model.blocks) {
      const el = section.querySelector(`.rp-block[data-block-index="${block.blockIndex}"]`);
      if (el) applyBlockHighlights(el, highlightColorsForBlock(block, resolved));
    }
  }, [model, resolved]);

  const page = model?.page ?? pendingPage(documentId, pageIndex);
  const className = ['rp-page', readable ? '' : 'rp-page--pending', contentVisibility ? 'rp-page--cv' : ''].filter(Boolean).join(' ');
  // PageStatusNotice shows nothing for a normal page; the reader only adds what it does not cover.
  const noticeKind = pageNoticeKind(page);
  // §25: a page waiting for the home computer is looked for more often while it is on screen.
  useEffect(() => {
    if (noticeKind === 'awaiting_ai') watchAiReading(documentId, pageIndex);
  }, [noticeKind, documentId, pageIndex]);

  return (
    <>
      <PageStatusNotice page={page} />
      <section ref={sectionRef} className={className} data-page-index={pageIndex} aria-label={format(reader.page.label, { page: pageIndex + 1 })}>
        {readable && model.blocks.length > 0 && model.blocks.map((block) => <ReaderBlock key={`${block.blockIndex}:${block.hash}`} block={block} coded={coded} />)}
        {readable && model.blocks.length === 0 && noticeKind === null && <p className="rp-page__empty">{reader.page.noText}</p>}
        {!readable && noticeKind === null && <p className="rp-page__empty">{reader.page.notReady}</p>}
        {readable && model.blocks.length > 0 && (
          <InkLayer documentId={documentId} childId={childId} view="text" pageIndex={pageIndex} containerRef={sectionRef} layoutKey={layoutKey} />
        )}
      </section>
    </>
  );
});

/** <article class="reader"> with the page(s): one page in page mode, all pages stacked in continuous mode. */
export function ReaderText(props: ReaderTextProps): JSX.Element {
  const {
    documentId, childId, pageCount, models, layoutMode, currentPage, reading, layoutKey, mode, highlights, selection, quote, speaking,
    speakingWord, showSpeaking, followSpeaking, freeSelection, articleRef, onWordTap, onBackgroundTap, onNativeSelection, onVisiblePage,
  } = props;
  const tap = useRef<{ pointerId: number; x: number; y: number; time: number } | null>(null);
  const contentVisibility = useMemo(() => layoutMode === 'continu' && supportsContentVisibility(), [layoutMode]);
  const indexes = layoutMode === 'page' ? [currentPage] : Array.from({ length: pageCount }, (_, i) => i);
  const renderedKey = `${layoutMode}:${layoutMode === 'page' ? currentPage : pageCount}`;
  const callbacks = useRef({ onVisiblePage, onNativeSelection });
  callbacks.current = { onVisiblePage, onNativeSelection };

  // Selection and quote marks.
  useLayoutEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    applyWordRangeClass(root, SEL_CLASS, selection);
  }, [articleRef, selection, models, renderedKey]);

  useLayoutEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const marked = applyWordRangeClass(root, QUOTE_CLASS, quote);
    if (quote && marked[0]) scrollIntoComfortZone(marked[0]);
  }, [articleRef, quote, models, renderedKey]);

  useLayoutEffect(() => {
    const root = articleRef.current;
    if (root) applyWordRangeClass(root, SPEAKING_WORD_CLASS, speakingWord);
  }, [articleRef, speakingWord, models, renderedKey]);

  // Sentence being read.
  const speakingKey = speaking ? `${speaking.pageIndex}:${speaking.blockIndex}:${speaking.sentenceIndex}` : null;
  const lastFollowed = useRef<string | null>(null);
  useLayoutEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const element = applySpeakingSentence(root, showSpeaking ? speaking : null);
    if (!speaking || !speakingKey) {
      lastFollowed.current = null;
      return;
    }
    const target = element ?? sentenceElementAt(root, speaking);
    if (!target) return;
    if (followSpeaking && lastFollowed.current !== speakingKey) {
      lastFollowed.current = speakingKey;
      scrollIntoComfortZone(target);
    }
  }, [articleRef, speakingKey, showSpeaking, followSpeaking, models, renderedKey]);

  // Current page in continuous mode: the section occupying most of the reading zone.
  useEffect(() => {
    const root = articleRef.current;
    if (!root || layoutMode !== 'continu') return undefined;
    const sections = Array.from(root.querySelectorAll<HTMLElement>('.rp-page'));
    const pick = (): void => {
      const height = window.innerHeight;
      let best = -1;
      let bestVisible = 0;
      for (const section of sections) {
        const rect = section.getBoundingClientRect();
        const visible = Math.min(rect.bottom, height * 0.75) - Math.max(rect.top, height * 0.1);
        if (visible > bestVisible) {
          bestVisible = visible;
          best = Number(section.getAttribute('data-page-index'));
        }
      }
      if (best >= 0) callbacks.current.onVisiblePage(best);
    };
    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver(pick, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
      for (const section of sections) observer.observe(section);
      return () => observer.disconnect();
    }
    let frame = 0;
    const onScroll = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(pick);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [articleRef, layoutMode, pageCount, models]);

  // Native selection (parent option): debounced, after the finger is lifted.
  useEffect(() => {
    const root = articleRef.current;
    if (!root || !freeSelection || mode !== 'lecture') return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let touching = false;
    const schedule = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        if (touching) return;
        const range = rangeFromNativeSelection(document.getSelection(), root);
        if (range && range.end > range.start) callbacks.current.onNativeSelection(range);
      }, NATIVE_SELECTION_DEBOUNCE_MS);
    };
    const onTouchStart = (): void => {
      touching = true;
      if (timer !== null) clearTimeout(timer);
    };
    const onTouchEnd = (): void => {
      touching = false;
      schedule();
    };
    document.addEventListener('selectionchange', schedule);
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    root.addEventListener('mouseup', schedule);
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('selectionchange', schedule);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('mouseup', schedule);
    };
  }, [articleRef, freeSelection, mode]);

  const onPointerDown = (event: PointerEvent<HTMLElement>): void => {
    tap.current = event.isPrimary ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp } : null;
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>): void => {
    const start = tap.current;
    tap.current = null;
    if (!start || start.pointerId !== event.pointerId || mode !== 'lecture') return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX || event.timeStamp - start.time > TAP_MAX_MS) return;
    const element = wordElementFromPoint(document, event.clientX, event.clientY, event.target);
    const position = element ? wordPosition(element) : null;
    if (element && position) onWordTap({ ...position, element });
    else onBackgroundTap();
  };

  const style: CSSProperties = readingStyleVars(reading);
  const aids = readingAidsOf(reading);
  const coded = hasReadingAids(aids);
  const className = [
    'reader', 'reading', readingFontClass(reading.font), `reader--${layoutMode}`, `reader--${mode}`, freeSelection ? 'reader--free-selection' : '',
    ...readingAidClasses(aids),
  ].filter(Boolean).join(' ');

  return (
    <article
      ref={articleRef}
      className={className}
      data-document-id={documentId}
      style={style}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        tap.current = null;
      }}
    >
      {indexes.map((pageIndex) => (
        <Fragment key={pageIndex}>
          {layoutMode === 'continu' && pageIndex > 0 && (
            <div className="rp-sep" role="separator" aria-label={format(reader.page.label, { page: pageIndex + 1 })}>
              <span aria-hidden="true">{format(reader.page.label, { page: pageIndex + 1 })}</span>
            </div>
          )}
          <ReaderPageSection
            documentId={documentId}
            childId={childId}
            pageIndex={pageIndex}
            model={models.get(pageIndex)}
            highlights={highlights}
            layoutKey={layoutKey}
            contentVisibility={contentVisibility}
            coded={coded}
          />
        </Fragment>
      ))}
    </article>
  );
}
