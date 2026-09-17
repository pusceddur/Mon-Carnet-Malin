import { DEFAULT_TTS_PREFERENCES,
  APP_NAME,
  HIGHLIGHTER_COLORS,
  LIMITS,
  type Annotation,
  type ReadingTheme,
  type SourceRef,
  type TextHighlight,
} from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { db } from '../../db/localDb';
import { ProcessingBanner } from '../../documents/ProcessingBanner';
import { ArrowLeftIcon, Button, EmptyState, IconButton, OfflineBadge, Segmented, Spinner, useToast } from '../../design/components';
import { applyTheme } from '../../design/reading';
import { format } from '../../i18n/fr';
import { reader } from '../../i18n/fr/reader';
import { tts as ttsStrings } from '../../i18n/fr/tts';
import { addTextHighlight, PencilToolbar, reanchor, removeAnnotation, useAnnotations, usePencilStore, type ReaderMode } from '../../pencil';
import { useSelectedChild, useSessionStore } from '../../state/session';
import { speechEngine } from '../../tts/SpeechEngine';
import { getStoredVoiceURI, setStoredVoiceURI } from '../../tts/voices';
import { HelpSheet, type HelpRequest } from './HelpSheet';
import { countsAsAiRequest, type HelpKind, type HelpOutcome, type HelpTextContext, type QuestionContext } from './helpActions';
import { usePageModels, useReaderPreferences, useReadingProgress, useReadingSession, useSpeechState, useViewportWidth } from './hooks';
import {
  buildSpeechItems,
  extendToNextWord,
  extendToPreviousWord,
  findQuote,
  highlightsInRange,
  isLowConfidence,
  isSingleWord,
  isWholeParagraph,
  isWholeSentence,
  layoutKeyOf,
  pagesInput,
  paragraphRange,
  parseSpeechItemId,
  rangeText,
  resolveHighlights,
  resolveInitialPage,
  selectWord,
  sentenceAt,
  sentenceRange,
  speechStartIndex,
  type TextRange,
} from './model';
import { sentenceElementAt, wordElementAt } from './decorations';
import { OriginalPageView } from './OriginalPageView';
import { ReaderMenu } from './ReaderMenu';
import { ReaderSettingsPanel } from './ReaderSettingsPanel';
import { ReaderText, scrollIntoComfortZone, type WordTap } from './ReaderText';
import { ReadingGuide, type GuideAnchor } from './ReadingGuide';
import { SelectionToolbar } from './SelectionToolbar';
import { TTSBar } from './TTSBar';
import './reader.css';

const QUOTE_MARK_MS = 8000;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function isHighlight(annotation: Annotation): annotation is TextHighlight {
  return annotation.type === 'highlight';
}

/** Route `/lire/:documentId?page=N&quote=…`: a fresh reader per document. */
export default function ReaderPage(): JSX.Element {
  const { documentId = '' } = useParams();
  return <ReaderScreen key={documentId} documentId={documentId} />;
}

function ReaderScreen({ documentId }: { documentId: string }): JSX.Element {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const seenLocation = useRef(location.key);
  const navigate = useNavigate();
  const toast = useToast();
  const child = useSelectedChild();
  const authStatus = useSessionStore((s) => s.authStatus);
  const freeSelection = useSessionStore((s) => s.parentSettings?.reader.freeSelection ?? false);
  const childId = child?.id ?? '';

  const doc = useLiveQuery(async () => (documentId ? (await db.documents.get(documentId)) ?? null : null), [documentId]);
  const pages = useLiveQuery(() => db.pages.where('documentId').equals(documentId).toArray(), [documentId]);
  const { models, ready: modelsReady } = usePageModels(pages);
  const modelByIndex = useMemo(() => new Map(models.map((m) => [m.pageIndex, m])), [models]);
  const pageCount = Math.max(doc?.pageCount ?? 0, models.length > 0 ? Math.max(...models.map((m) => m.pageIndex)) + 1 : 0);

  const prefs = useReaderPreferences(child);
  const { reading, tts } = prefs;
  const annotations = useAnnotations(documentId, childId);
  const highlights = useMemo(() => annotations.filter(isHighlight), [annotations]);
  const mode = usePencilStore((s) => s.mode);
  const setMode = usePencilStore((s) => s.setMode);
  const speech = useSpeechState();
  const progress = useReadingProgress(child?.id ?? null, documentId || undefined);
  const session = useReadingSession(child?.id ?? null, documentId || undefined);
  const viewportWidth = useViewportWidth();

  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [view, setView] = useState<'text' | 'original'>('text');
  const [panel, setPanel] = useState<'settings' | 'menu' | null>(null);
  const [ttsOpen, setTtsOpen] = useState(false);
  const [selection, setSelection] = useState<TextRange | null>(null);
  const [quoteRequest, setQuoteRequest] = useState<SourceRef | null>(null);
  const [quote, setQuote] = useState<TextRange | null>(null);
  const [helpRequest, setHelpRequest] = useState<HelpRequest | null>(null);
  const [guideAnchor, setGuideAnchor] = useState<GuideAnchor | null>(null);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const articleRef = useRef<HTMLElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const helpSeq = useRef(0);
  const guideSeq = useRef(0);

  const layoutMode = reading.layoutMode;
  const layoutKey = layoutKeyOf(reading, viewportWidth);
  const items = useMemo(() => buildSpeechItems(models), [models]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // ---------- lifecycle ----------

  useEffect(() => {
    setMode('lecture');
  }, [setMode]);

  useEffect(() => () => speechEngine.stop(), []);

  useEffect(() => {
    if (!doc) return undefined;
    const previous = document.title;
    document.title = `${doc.title} · ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [doc]);

  // Reading theme for the whole screen (sheets included) while the reader is open.
  const initialTheme = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (initialTheme.current === undefined) initialTheme.current = document.documentElement.getAttribute('data-theme');
    applyTheme(reading.theme);
  }, [reading.theme]);
  useEffect(() => () => {
    const previous = initialTheme.current;
    applyTheme(previous === 'creme' || previous === 'clair' || previous === 'sombre' ? (previous as ReadingTheme) : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getStoredVoiceURI().then((uri) => {
      if (cancelled) return;
      setVoiceURI(uri);
      speechEngine.setVoice(uri);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    speechEngine.setRate(tts.rate);
    speechEngine.setPitch(tts.pitch);
    // Profiles cached before the pause settings existed have no value: engine defaults.
    speechEngine.setPauses(tts.sentencePauseMs ?? DEFAULT_TTS_PREFERENCES.sentencePauseMs, tts.paragraphPauseMs ?? DEFAULT_TTS_PREFERENCES.paragraphPauseMs);
  }, [tts.rate, tts.pitch, tts.sentencePauseMs, tts.paragraphPauseMs]);

  const speechEnded = useRef(false);
  useEffect(() => speechEngine.subscribeEvents((event) => {
    if (event.type === 'ended') speechEnded.current = true;
    else toast.warning(event.kind === 'unsupported' ? ttsStrings.unsupported : ttsStrings.startFailed);
  }), [toast]);

  // Initial page: ?page=N (1-based), else the saved progress, else the first page.
  useEffect(() => {
    if (currentPage !== null || !doc || !progress.loaded) return;
    const initial = resolveInitialPage({ urlPage: searchParams.get('page'), progressPage: progress.progress?.pageIndex ?? null, pageCount });
    setCurrentPage(initial);
    const quoteParam = searchParams.get('quote');
    if (quoteParam) setQuoteRequest({ pageIndex: initial, quote: quoteParam });
    seenLocation.current = location.key;
  }, [currentPage, doc, progress.loaded, progress.progress, pageCount, searchParams, location.key]);

  // Continuous mode: bring the initial page into view once its section exists.
  const scrolledInitially = useRef(false);
  useEffect(() => {
    if (scrolledInitially.current || currentPage === null || !modelsReady) return;
    scrolledInitially.current = true;
    if (layoutMode !== 'continu' || currentPage === 0) return;
    articleRef.current?.querySelector(`.rp-page[data-page-index="${currentPage}"]`)?.scrollIntoView({ block: 'start' });
  }, [currentPage, modelsReady, layoutMode]);

  // Temporary quote highlight (exercises, answers to a question).
  useEffect(() => {
    if (!quoteRequest || !modelsReady) return;
    const model = modelByIndex.get(quoteRequest.pageIndex);
    setQuoteRequest(null);
    const range = model ? findQuote(model.blocks, quoteRequest.quote) : null;
    if (range) setQuote(range);
    else toast.info(reader.quote.notFound);
  }, [quoteRequest, modelsReady, modelByIndex, toast]);

  useEffect(() => {
    if (!quote) return undefined;
    const timer = setTimeout(() => setQuote(null), QUOTE_MARK_MS);
    return () => clearTimeout(timer);
  }, [quote]);

  // Speech queue follows the readable pages (keeps the position while listening).
  const progressRef = useRef(progress.progress);
  progressRef.current = progress.progress;
  const startIndexForPage = useCallback((pageIndex: number): number => {
    const saved = progressRef.current;
    const list = itemsRef.current;
    return saved && saved.pageIndex === pageIndex ? speechStartIndex(list, saved) : speechStartIndex(list, { pageIndex });
  }, []);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const pageResolved = currentPage !== null;
  useEffect(() => {
    const page = currentPageRef.current;
    if (!pageResolved || page === null) return;
    speechEngine.setQueue(items, startIndexForPage(page));
  }, [items, startIndexForPage, pageResolved]);

  // Following the voice: page turns in page mode, progress, session.
  const speaking = speech.status !== 'idle' ? parseSpeechItemId(speech.itemId) : null;
  // Word being read, only when the engine receives `boundary` events (C4).
  const speakingWord = useMemo((): TextRange | null => {
    const position = parseSpeechItemId(speech.itemId);
    const range = speech.wordRange;
    if (speech.status !== 'playing' || !position || !range) return null;
    const sentence = modelByIndex.get(position.pageIndex)?.blocks[position.blockIndex]?.sentences[position.sentenceIndex];
    if (!sentence) return null;
    return { pageIndex: position.pageIndex, blockIndex: position.blockIndex, start: sentence.start + range.start, end: sentence.start + range.end };
  }, [speech.itemId, speech.status, speech.wordRange, modelByIndex]);

  // Reading guide on the voice: the line of the word being read when the engine sends `boundary` events,
  // otherwise the whole sentence. Measured again on scroll, so the band stays on the text during the smooth scroll.
  const guideEnabled = reading.readingGuide && view === 'text';
  const lastGuideWord = useRef<{ itemId: string; range: { start: number; end: number } } | null>(null);
  const boundariesSeen = useRef(false);
  useEffect(() => {
    const position = speech.status !== 'idle' ? parseSpeechItemId(speech.itemId) : null;
    if (!guideEnabled || !position || !speech.itemId) {
      if (!position) lastGuideWord.current = null;
      setGuideAnchor((current) => (current?.follow ? null : current));
      return;
    }
    const itemId = speech.itemId;
    if (speech.wordRange) {
      boundariesSeen.current = true;
      lastGuideWord.current = { itemId, range: speech.wordRange };
    }
    // Paused: the engine forgets the word, the band stays on it.
    const word = lastGuideWord.current?.itemId === itemId ? lastGuideWord.current.range : null;
    const sentence = modelByIndex.get(position.pageIndex)?.blocks[position.blockIndex]?.sentences[position.sentenceIndex];
    const wordRange: TextRange | null = word && sentence
      ? { pageIndex: position.pageIndex, blockIndex: position.blockIndex, start: sentence.start + word.start, end: sentence.start + word.end }
      : null;
    setGuideAnchor({
      key: `voice:${itemId}`,
      resolve: () => {
        const root = articleRef.current;
        if (!root) return null;
        return (wordRange ? wordElementAt(root, wordRange) : null) ?? sentenceElementAt(root, position);
      },
      lines: wordRange || boundariesSeen.current ? 'first' : 'all',
      follow: true,
    });
  }, [guideEnabled, speech.itemId, speech.status, speech.wordRange, modelByIndex, layoutKey, layoutMode, currentPage]);

  // Long sentences: the line being read never leaves the screen.
  useEffect(() => {
    const root = articleRef.current;
    if (!root || !speakingWord || view !== 'text') return;
    const word = wordElementAt(root, speakingWord);
    if (!word) return;
    const rect = word.getBoundingClientRect();
    const height = window.innerHeight;
    if (rect.top < height * 0.08 || rect.bottom > height * 0.85) scrollIntoComfortZone(word);
  }, [speakingWord, view]);
  const saveProgress = progress.save;
  useEffect(() => {
    const position = parseSpeechItemId(speech.itemId);
    if (speech.status !== 'playing' || !position) return;
    if (layoutMode === 'page' && currentPageRef.current !== position.pageIndex) {
      setCurrentPage(position.pageIndex);
      setSelection(null);
    }
    saveProgress(position);
    session.current?.markPage(position.pageIndex);
  }, [speech.itemId, speech.status, layoutMode, saveProgress, session]);

  useEffect(() => {
    const tracker = session.current;
    if (!tracker) return;
    if (speech.status === 'playing') tracker.ttsStarted();
    else tracker.ttsStopped();
  }, [speech.status, session]);

  // Page change bookkeeping.
  useEffect(() => {
    if (currentPage === null) return;
    session.current?.markPage(currentPage);
    if (speechEngine.getState().status !== 'idle') return;
    const saved = progressRef.current;
    if (saved && saved.pageIndex === currentPage) return;
    saveProgress({ pageIndex: currentPage, blockIndex: 0, sentenceIndex: 0 });
  }, [currentPage, saveProgress, session]);

  useEffect(() => {
    if (mode === 'annotation') setSelection(null);
  }, [mode]);

  // Space for the bottom dock.
  const selectionModel = selection ? modelByIndex.get(selection.pageIndex) : undefined;
  const selectionBlock = selection ? selectionModel?.blocks[selection.blockIndex] : undefined;
  const selectionBarVisible = selection !== null && selectionBlock !== undefined && view === 'text' && mode === 'lecture';
  const dockVisible = selectionBarVisible || ttsOpen;
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dockVisible || !dock) {
      setDockHeight(0);
      return undefined;
    }
    const measure = (): void => setDockHeight(Math.round(dock.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [dockVisible]);

  // The pencil toolbar is portaled to <body>: publish the dock height on the root so it sits above the dock.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--rd-dock-h', `${dockHeight}px`);
    return () => {
      root.style.removeProperty('--rd-dock-h');
    };
  }, [dockHeight]);

  // ---------- navigation ----------

  const goToPage = useCallback((target: number) => {
    if (pageCount === 0) return;
    const index = Math.min(pageCount - 1, Math.max(0, target));
    setCurrentPage(index);
    setSelection(null);
    const state = speechEngine.getState();
    if (state.status !== 'idle') speechEngine.stop();
    speechEngine.setQueue(itemsRef.current, speechStartIndex(itemsRef.current, { pageIndex: index }));
    if (layoutMode === 'continu') {
      articleRef.current?.querySelector(`.rp-page[data-page-index="${index}"]`)?.scrollIntoView({ block: 'start' });
    } else if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0 });
    }
  }, [pageCount, layoutMode]);

  useEffect(() => {
    if (layoutMode !== 'page' || panel !== null || helpRequest !== null || currentPage === null) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.key === 'ArrowRight') goToPage(currentPage + 1);
      if (event.key === 'ArrowLeft') goToPage(currentPage - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layoutMode, panel, helpRequest, currentPage, goToPage]);

  const onVisiblePage = useCallback((pageIndex: number) => {
    setCurrentPage((current) => (current === pageIndex ? current : pageIndex));
  }, []);

  const showQuote = useCallback((ref: SourceRef) => {
    setHelpRequest(null);
    if (currentPageRef.current !== ref.pageIndex) goToPage(ref.pageIndex);
    setQuoteRequest(ref);
  }, [goToPage]);

  // A new ?page / ?quote while the reader stays open for the same book.
  useEffect(() => {
    if (seenLocation.current === location.key || currentPageRef.current === null) return;
    seenLocation.current = location.key;
    const pageParam = searchParams.get('page');
    const quoteParam = searchParams.get('quote');
    if (pageParam === null && quoteParam === null) return;
    const target = resolveInitialPage({ urlPage: pageParam, progressPage: currentPageRef.current, pageCount });
    if (target !== currentPageRef.current) goToPage(target);
    if (quoteParam) setQuoteRequest({ pageIndex: target, quote: quoteParam });
  }, [location.key, searchParams, pageCount, goToPage]);

  // ---------- selection ----------

  const onWordTap = useCallback((tap: WordTap) => {
    const block = modelByIndex.get(tap.pageIndex)?.blocks[tap.blockIndex];
    if (!block) return;
    const range = selectWord(block, tap.offset);
    setSelection((current) =>
      current && range && current.pageIndex === range.pageIndex && current.blockIndex === range.blockIndex && current.start === range.start
        && current.end === range.end ? null : range);
    guideSeq.current += 1;
    const element = tap.element;
    setGuideAnchor({ key: `tap:${guideSeq.current}`, resolve: () => element, lines: 'first', follow: false });
  }, [modelByIndex]);

  const onNativeSelection = useCallback((range: TextRange) => {
    setSelection(range);
    window.getSelection()?.removeAllRanges();
  }, []);

  const selectionHighlights = useMemo(() => {
    if (!selection || !selectionModel) return [];
    return highlightsInRange(resolveHighlights(selectionModel, highlights, reanchor), selection);
  }, [selection, selectionModel, highlights]);

  const helpContext = useCallback((range: TextRange): HelpTextContext | null => {
    const model = modelByIndex.get(range.pageIndex);
    const block = model?.blocks[range.blockIndex];
    if (!doc || !model || !block || !child) return null;
    const sentence = sentenceRange(block, range);
    return {
      childId: child.id,
      documentId: doc.id,
      documentHash: SHA256_HEX.test(doc.sourceHash) ? doc.sourceHash : null,
      pageIndex: range.pageIndex,
      text: rangeText(block, range).slice(0, LIMITS.selectionMaxChars),
      isSingleWord: isSingleWord(block, range),
      sentence: rangeText(block, sentence),
      paragraph: block.text,
      ocrLowConfidence: isLowConfidence(model.page),
    };
  }, [modelByIndex, doc, child]);

  const openHelp = (kind: 'definition' | 'explain' | 'simplify'): void => {
    if (!selection) return;
    const ctx = helpContext(selection);
    if (!ctx) return;
    if (ctx.text.length >= LIMITS.selectionMaxChars) toast.info(reader.selection.tooLong);
    helpSeq.current += 1;
    setHelpRequest({ id: helpSeq.current, kind, ctx });
  };

  const toggleHighlight = async (): Promise<void> => {
    if (!selection || !selectionBlock || !child || !doc) return;
    try {
      if (selectionHighlights.length > 0) {
        await Promise.all(selectionHighlights.map((h) => removeAnnotation(h.id)));
        toast.success(reader.selection.unhighlighted);
      } else {
        await addTextHighlight({
          childId: child.id, documentId: doc.id, color: HIGHLIGHTER_COLORS.jaune, pageIndex: selection.pageIndex, blockIndex: selection.blockIndex,
          start: selection.start, end: selection.end, blockTextHash: selectionBlock.hash, text: rangeText(selectionBlock, selection),
        });
        toast.success(reader.selection.highlighted);
      }
      setSelection(null);
    } catch {
      toast.error(reader.selection.highlightFailed);
    }
  };

  const loadQuestionContext = useCallback(async (): Promise<QuestionContext | null> => {
    if (!doc || !child || !pages) return null;
    const inputs = await pagesInput(pages, LIMITS.pagesMaxTotalChars, currentPageRef.current ?? 0);
    return { childId: child.id, documentId: doc.id, documentHash: SHA256_HEX.test(doc.sourceHash) ? doc.sourceHash : null, pages: inputs };
  }, [doc, child, pages]);

  const onHelpOutcome = useCallback((kind: HelpKind, outcome: HelpOutcome) => {
    const tracker = session.current;
    if (!tracker) return;
    if (kind === 'definition' || kind === 'explain') tracker.countLookup();
    if (countsAsAiRequest(kind, outcome)) tracker.countAiRequest();
  }, [session]);

  // ---------- speech controls (called from taps: iOS needs the gesture) ----------

  const startListening = (): void => {
    const state = speechEngine.getState();
    if (state.status === 'playing') return;
    if (state.status === 'paused') {
      speechEngine.play();
      return;
    }
    const list = itemsRef.current;
    if (list.length === 0) {
      toast.info(ttsStrings.nothingToRead);
      return;
    }
    let start: number;
    const ended = speechEnded.current;
    speechEnded.current = false;
    if (selection && selectionBlock) {
      start = speechStartIndex(list, { pageIndex: selection.pageIndex, blockIndex: selection.blockIndex, sentenceIndex: sentenceAt(selectionBlock, selection.start)?.index ?? 0 });
    } else {
      // Keep a position moved with ⏮ ⏭ on this page; after the end of the book, start the page again.
      const position = parseSpeechItemId(state.itemId);
      const page = currentPageRef.current ?? 0;
      if (ended) start = speechStartIndex(list, { pageIndex: page });
      else start = position && position.pageIndex === page ? state.index : startIndexForPage(page);
    }
    speechEngine.setQueue(list, start);
    speechEngine.play();
  };

  const toggleTts = (): void => {
    if (ttsOpen) {
      speechEngine.stop();
      setTtsOpen(false);
      return;
    }
    setTtsOpen(true);
    startListening();
  };

  // ---------- render ----------

  if (!child) {
    return authStatus === null
      ? <main className="rd-screen rd-screen--center"><Spinner label={reader.loading} /></main>
      : <Navigate to="/" replace />;
  }
  if (doc === undefined || (doc !== null && currentPage === null)) {
    return <main className="rd-screen rd-screen--center"><Spinner label={reader.loading} /></main>;
  }
  if (doc === null || doc.deletedAt !== null) {
    return (
      <main className="rd-screen rd-screen--center">
        <EmptyState
          emoji="📚"
          title={reader.notFound.title}
          message={reader.notFound.message}
          action={<Button onClick={() => navigate('/livres')}>{reader.notFound.action}</Button>}
        />
      </main>
    );
  }
  const page = currentPage ?? 0;
  const currentModel = modelByIndex.get(page);
  const lineHeightPx = reading.fontSizePx * reading.lineHeight;
  const pagerVisible = pageCount > 1 && (layoutMode === 'page' || view === 'original');
  const pageLabel = format(reader.header.pageOf, { current: page + 1, total: Math.max(pageCount, 1) });
  const screenStyle = { '--rd-dock-h': `${dockHeight}px` } as CSSProperties;

  return (
    <div className="rd-screen" style={screenStyle}>
      <header className="rd-header">
        <IconButton aria-label={reader.header.back} icon={<ArrowLeftIcon />} onClick={() => navigate('/livres')} />
        <div className="rd-header__title">
          <h1 className="rd-header__book">{doc.title}</h1>
          <p className="rd-header__page" aria-live="polite">{pageLabel} <OfflineBadge className="rd-header__offline" /></p>
        </div>
        <Segmented<ReaderMode>
          className="rd-header__mode"
          label={reader.header.modeLabel}
          hideLabel
          value={mode}
          options={[
            { value: 'annotation', label: reader.header.modeAnnotation, icon: '✏️' },
            { value: 'lecture', label: reader.header.modeLecture, icon: '📖' },
          ]}
          onChange={setMode}
        />
        <div className="rd-header__actions">
          <IconButton aria-label={reader.header.settings} icon={<span className="rd-header__aa" aria-hidden="true">{reader.settings.fontSample}</span>} onClick={() => setPanel('settings')} />
          <IconButton aria-label={ttsOpen ? reader.header.listenClose : reader.header.listen} icon="🔊" pressed={ttsOpen} onClick={toggleTts} />
          <IconButton aria-label={reader.header.menu} icon="⋯" onClick={() => setPanel('menu')} />
        </div>
      </header>

      <ProcessingBanner documentId={doc.id} />

      <main className="rd-main">
        {view === 'text'
          ? (
            <ReaderText
              documentId={doc.id}
              childId={child.id}
              pageCount={Math.max(pageCount, 1)}
              models={modelByIndex}
              layoutMode={layoutMode}
              currentPage={page}
              reading={reading}
              layoutKey={layoutKey}
              mode={mode}
              highlights={highlights}
              selection={selection}
              quote={quote}
              speaking={speaking}
              showSpeaking={reading.sentenceHighlight}
              speakingWord={reading.sentenceHighlight ? speakingWord : null}
              followSpeaking={speech.status === 'playing'}
              freeSelection={freeSelection}
              articleRef={articleRef}
              onWordTap={onWordTap}
              onBackgroundTap={() => setSelection(null)}
              onNativeSelection={onNativeSelection}
              onVisiblePage={onVisiblePage}
            />
          )
          : (
            <OriginalPageView documentId={doc.id} childId={child.id} pageIndex={page} page={currentModel?.page ?? null} layoutKey={layoutKey} />
          )}

        {pagerVisible && (
          <nav className="rd-pager" aria-label={reader.nav.label}>
            <Button variant="secondary" aria-label={reader.nav.previousLabel} disabled={page <= 0} onClick={() => goToPage(page - 1)}>
              {reader.nav.previous}
            </Button>
            <span className="rd-pager__label">{pageLabel}</span>
            <Button variant="primary" aria-label={reader.nav.nextLabel} disabled={page >= pageCount - 1} onClick={() => goToPage(page + 1)}>
              {reader.nav.next}
            </Button>
          </nav>
        )}
      </main>

      {mode === 'annotation' && <PencilToolbar />}
      {reading.readingGuide && view === 'text' && <ReadingGuide lineHeightPx={lineHeightPx} anchor={guideAnchor} />}

      {dockVisible && (
        <div ref={dockRef} className="rd-dock">
          {selectionBarVisible && selection && selectionBlock && (
            <SelectionToolbar
              text={rangeText(selectionBlock, selection)}
              canDefine={isSingleWord(selectionBlock, selection)}
              highlighted={selectionHighlights.length > 0}
              canExtendPrevious={extendToPreviousWord(selectionBlock, selection).start !== selection.start}
              canExtendNext={extendToNextWord(selectionBlock, selection).end !== selection.end}
              wholeSentence={isWholeSentence(selectionBlock, selection)}
              wholeParagraph={isWholeParagraph(selectionBlock, selection)}
              onRead={() => speechEngine.speakOnce(rangeText(selectionBlock, selection))}
              onDefine={() => openHelp('definition')}
              onExplain={() => openHelp('explain')}
              onSimplify={() => openHelp('simplify')}
              onHighlight={() => void toggleHighlight()}
              onPreviousWord={() => setSelection(extendToPreviousWord(selectionBlock, selection))}
              onNextWord={() => setSelection(extendToNextWord(selectionBlock, selection))}
              onSentence={() => setSelection(sentenceRange(selectionBlock, selection))}
              onParagraph={() => setSelection(paragraphRange(selectionBlock))}
              onClose={() => setSelection(null)}
            />
          )}
          {ttsOpen && (
            <TTSBar
              state={speech}
              rate={tts.rate}
              canPrevious={speech.index > 0}
              canNext={speech.index < items.length - 1}
              onPlay={startListening}
              onPause={() => speechEngine.pause()}
              onStop={() => speechEngine.stop()}
              onPrevious={() => speechEngine.previous()}
              onNext={() => speechEngine.next()}
              onRateChange={(rate) => prefs.update({ tts: { rate } })}
              onClose={toggleTts}
            />
          )}
        </div>
      )}

      <ReaderSettingsPanel
        open={panel === 'settings'}
        onClose={() => setPanel(null)}
        reading={reading}
        tts={tts}
        onChange={prefs.update}
        onReset={prefs.reset}
        voiceURI={voiceURI}
        onVoiceChange={(uri) => {
          setVoiceURI(uri);
          speechEngine.setVoice(uri);
          void setStoredVoiceURI(uri);
        }}
      />
      <ReaderMenu
        open={panel === 'menu'}
        view={view}
        onClose={() => setPanel(null)}
        onQuestion={() => {
          setPanel(null);
          helpSeq.current += 1;
          setHelpRequest({ id: helpSeq.current, kind: 'question' });
        }}
        onExercises={() => navigate(`/exercices/${encodeURIComponent(doc.id)}/questions`)}
        onSummary={() => navigate(`/exercices/${encodeURIComponent(doc.id)}/resume`)}
        onToggleView={doc.kind === 'epub' ? undefined : () => {
          setPanel(null);
          setSelection(null);
          setView((v) => (v === 'text' ? 'original' : 'text'));
        }}
      />
      <HelpSheet
        request={helpRequest}
        onClose={() => setHelpRequest(null)}
        onExplainInstead={(ctx) => {
          helpSeq.current += 1;
          setHelpRequest({ id: helpSeq.current, kind: 'explain', ctx });
        }}
        onShowQuote={showQuote}
        loadQuestionContext={loadQuestionContext}
        onOutcome={onHelpOutcome}
      />
    </div>
  );
}
