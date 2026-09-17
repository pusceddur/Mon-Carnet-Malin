import {
  DEFAULT_READING_PREFERENCES,
  DEFAULT_TTS_PREFERENCES,
  type ChildProfile,
  type Id,
  type PageContent,
  type ReadingPreferences,
  type ReadingProgress,
  type TTSPreferences,
} from '@aide/shared';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { db } from '../../db/localDb';
import { saveEntity } from '../../sync/SyncEngine';
import { speechEngine, type SpeechState } from '../../tts/SpeechEngine';
import { buildPageModel, type PageModel } from './model';
import { effectiveReading, effectiveTts, isEmptyPatch, mergePatch, savePreferences, type PreferencesPatch } from './preferences';
import { ProgressSaver, ReadingSessionTracker, type ReadingPosition } from './tracking';

// ---------- speech ----------

const subscribeSpeech = (onChange: () => void): (() => void) => speechEngine.subscribe(() => onChange());
const speechSnapshot = (): SpeechState => speechEngine.getState();

export function useSpeechState(): SpeechState {
  return useSyncExternalStore(subscribeSpeech, speechSnapshot, speechSnapshot);
}

// ---------- page models ----------

const modelCache = new Map<string, Promise<PageModel>>();

function modelKey(page: PageContent): string {
  return `${page.documentId}:${page.pageIndex}:${page.status}:${page.updatedAt}:${page.contentHash ?? ''}:${page.blocks.length}`;
}

function cachedModel(page: PageContent): Promise<PageModel> {
  const key = modelKey(page);
  let model = modelCache.get(key);
  if (!model) {
    if (modelCache.size > 400) modelCache.clear();
    model = buildPageModel(page);
    modelCache.set(key, model);
  }
  return model;
}

/** Page models (blocks, sentences, words, hashes) built asynchronously; unchanged pages keep their model identity. */
export function usePageModels(pages: readonly PageContent[] | undefined): { models: PageModel[]; ready: boolean } {
  const key = pages ? pages.map(modelKey).join('|') : null;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const [state, setState] = useState<{ key: string | null; models: PageModel[] }>({ key: null, models: [] });

  useEffect(() => {
    const current = pagesRef.current;
    if (key === null || !current) return undefined;
    let cancelled = false;
    Promise.all(current.map(cachedModel)).then(
      (models) => {
        if (!cancelled) setState({ key, models: models.sort((a, b) => a.pageIndex - b.pageIndex) });
      },
      () => {
        if (!cancelled) setState({ key, models: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { models: state.models, ready: key !== null && state.key === key };
}

// ---------- viewport ----------

export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  useEffect(() => {
    let frame = 0;
    const onResize = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return width;
}

// ---------- preferences ----------

const SAVE_DELAY_MS = 800;

export interface ReaderPreferencesApi {
  reading: ReadingPreferences;
  tts: TTSPreferences;
  update(patch: PreferencesPatch): void;
  reset(): void;
}

/** Effective preferences with immediate local overrides; saved after a short pause and when leaving the reader. */
export function useReaderPreferences(child: ChildProfile | null): ReaderPreferencesApi {
  const [override, setOverride] = useState<PreferencesPatch>({});
  const pending = useRef<PreferencesPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const childId = child?.id ?? null;

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (childId && !isEmptyPatch(patch)) void savePreferences(childId, patch);
  }, [childId]);

  useEffect(() => flush, [flush]);

  const update = useCallback((patch: PreferencesPatch) => {
    setOverride((current) => mergePatch(current, patch));
    pending.current = mergePatch(pending.current, patch);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

  const reset = useCallback(() => {
    update({ reading: { ...DEFAULT_READING_PREFERENCES }, tts: { ...DEFAULT_TTS_PREFERENCES } });
  }, [update]);

  // Stable identities while values are unchanged (effects depend on them).
  const readingKey = JSON.stringify(effectiveReading(child, override));
  const ttsKey = JSON.stringify(effectiveTts(child, override));
  const reading = useMemo(() => JSON.parse(readingKey) as ReadingPreferences, [readingKey]);
  const tts = useMemo(() => JSON.parse(ttsKey) as TTSPreferences, [ttsKey]);

  return useMemo(() => ({ reading, tts, update, reset }), [reading, tts, update, reset]);
}

// ---------- progress & session ----------

function onLeave(handler: () => void): () => void {
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') handler();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', handler);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', handler);
  };
}

export function useReadingProgress(childId: Id | null, documentId: Id | undefined): {
  loaded: boolean;
  progress: ReadingProgress | null;
  save(position: ReadingPosition): void;
} {
  const [state, setState] = useState<{ key: string | null; progress: ReadingProgress | null }>({ key: null, progress: null });
  const saver = useRef<ProgressSaver | null>(null);
  const key = childId && documentId ? `${childId}:${documentId}` : null;

  useEffect(() => {
    if (!childId || !documentId) return undefined;
    let cancelled = false;
    const instance = new ProgressSaver(childId, documentId, (p) => saveEntity('progress', p));
    saver.current = instance;
    const loaded = (progress: ReadingProgress | null): void => {
      if (cancelled) return;
      instance.prime(progress ? { pageIndex: progress.pageIndex, blockIndex: progress.blockIndex, sentenceIndex: progress.sentenceIndex } : null);
      setState({ key: `${childId}:${documentId}`, progress });
    };
    db.progress.get([childId, documentId]).then((p) => loaded(p ?? null), () => loaded(null));
    const stopListening = onLeave(() => void instance.flush());
    return () => {
      cancelled = true;
      stopListening();
      void instance.flush();
      if (saver.current === instance) saver.current = null;
    };
  }, [childId, documentId]);

  const save = useCallback((position: ReadingPosition) => saver.current?.update(position), []);
  return { loaded: key !== null && state.key === key, progress: state.key === key ? state.progress : null, save };
}

const SESSION_PERSIST_MS = 60_000;

export function useReadingSession(childId: Id | null, documentId: Id | undefined): RefObject<ReadingSessionTracker | null> {
  const tracker = useRef<ReadingSessionTracker | null>(null);
  useEffect(() => {
    if (!childId || !documentId) return undefined;
    const instance = new ReadingSessionTracker(childId, documentId, (s) => saveEntity('sessions', s));
    tracker.current = instance;
    const interval = setInterval(() => void instance.persist(), SESSION_PERSIST_MS);
    const stopListening = onLeave(() => void instance.persist());
    return () => {
      clearInterval(interval);
      stopListening();
      instance.ttsStopped();
      void instance.persist();
      if (tracker.current === instance) tracker.current = null;
    };
  }, [childId, documentId]);
  return tracker;
}
