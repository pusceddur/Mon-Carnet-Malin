// §22 « Préparer la lecture » from the reader: the page on screen goes to the home computer, which punctuates it for the
// voice; the prepared text comes back with the synchronization (asked every 10 s for 3 minutes).
import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareReading } from '../../api/documents';
import { ApiError } from '../../api/http';
import { tts } from '../../i18n/fr/tts';
import { syncNow } from '../../sync/SyncEngine';
import type { PageModel } from './model';

const t = tts.prepare;

export type PreparationStatus = 'idle' | 'sending' | 'waiting' | 'ready';

export const PREPARATION_POLL_MS = 10_000;
export const PREPARATION_WAIT_MS = 3 * 60_000;

/** The voice reads at least one sentence of the page from a preparation. */
export function isPagePrepared(model: PageModel | undefined): boolean {
  return model?.blocks.some((b) => b.sentences.some((s) => s.spoken !== null)) ?? false;
}

export interface PreparationNotify {
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export function useReadingPreparation(
  documentId: string, pageIndex: number | null, model: PageModel | undefined, notify: PreparationNotify,
): { status: PreparationStatus; prepare(): void } {
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState<{ pageIndex: number; since: number } | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const prepared = isPagePrepared(model);

  // The prepared text arrived for the page we wait for.
  useEffect(() => {
    if (waiting !== null && waiting.pageIndex === pageIndex && prepared) {
      setWaiting(null);
      notifyRef.current.success(t.ready);
    }
  }, [waiting, pageIndex, prepared]);

  // Ask for the result with the synchronization, for a while.
  useEffect(() => {
    if (waiting === null) return undefined;
    const poll = setInterval(() => void syncNow(), PREPARATION_POLL_MS);
    const stop = setTimeout(() => {
      setWaiting(null);
      notifyRef.current.info(t.later);
    }, Math.max(0, waiting.since + PREPARATION_WAIT_MS - Date.now()));
    return () => {
      clearInterval(poll);
      clearTimeout(stop);
    };
  }, [waiting]);

  const prepare = useCallback((): void => {
    if (pageIndex === null || sending) return;
    const page = pageIndex;
    setSending(true);
    void prepareReading(documentId, { pageIndexes: [page] })
      .then((response) => {
        if (response.unavailable !== null) {
          notifyRef.current.info(t.unavailable);
          return;
        }
        notifyRef.current.info(response.queued > 0 ? t.queued : t.already);
        setWaiting({ pageIndex: page, since: Date.now() });
      })
      .catch((error: unknown) => {
        notifyRef.current.warning(error instanceof ApiError && error.code === 'offline' ? t.offline : t.failed);
      })
      .finally(() => setSending(false));
  }, [documentId, pageIndex, sending]);

  const status: PreparationStatus = sending
    ? 'sending'
    : prepared
      ? 'ready'
      : waiting !== null && waiting.pageIndex === pageIndex
        ? 'waiting'
        : 'idle';
  return { status, prepare };
}
