// §22 « Préparer la lecture » in the reader: one button in the reading bar, then the voice uses the prepared text.
import { DEFAULT_TTS_PREFERENCES } from '@aide/shared';
import { act, useState, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlockModel, type PageModel } from '../../src/features/reader/model';
import { isPagePrepared, PREPARATION_POLL_MS, PREPARATION_WAIT_MS, useReadingPreparation } from '../../src/features/reader/readingPreparation';
import { TTSBar } from '../../src/features/reader/TTSBar';
import { tts } from '../../src/i18n/fr/tts';
import type { SpeechState } from '../../src/tts/SpeechEngine';
import { buttonByText, cleanup, click, render, waitFor } from '../shell/render';

const api = vi.hoisted(() => ({ prepareReading: vi.fn(), syncNow: vi.fn(async () => undefined) }));
vi.mock('../../src/api/documents', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/api/documents')>()), prepareReading: api.prepareReading }));
vi.mock('../../src/sync/SyncEngine', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/sync/SyncEngine')>()), syncNow: api.syncNow }));

const p = tts.prepare;
const TEXT = "1: lis l'article 2: souligne les verbes";

function pageModel(spoken?: string): PageModel {
  const block = buildBlockModel(4, 0, { kind: 'paragraph', text: TEXT, ...(spoken === undefined ? {} : { spoken }) }, 'h');
  return {
    pageIndex: 4, status: 'ready', blocks: [block],
    page: { documentId: 'd1', pageIndex: 4, status: 'ready', textSource: 'ocr-ai', blocks: [], confidence: null, contentHash: null, width: null, height: null, warnings: [], updatedAt: 1 },
  };
}

const notify = { info: vi.fn(), success: vi.fn(), warning: vi.fn() };
let setModel: ((m: PageModel) => void) | null = null;

function Harness({ initial }: { initial: PageModel }): JSX.Element {
  const [model, set] = useState(initial);
  setModel = set;
  const { status, prepare } = useReadingPreparation('d1', 4, model, notify);
  const state: SpeechState = { status: 'idle', index: 0, itemId: null, rate: DEFAULT_TTS_PREFERENCES.rate, wordRange: null, supported: true };
  return (
    <>
      <output data-status={status} />
      <TTSBar
        state={state} rate={1} canPrevious={false} canNext={false} onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} onPrevious={vi.fn()}
        onNext={vi.fn()} onRateChange={vi.fn()} onClose={vi.fn()} preparation={{ status, onPrepare: prepare }}
      />
    </>
  );
}

const statusOf = (container: HTMLElement): string | null => container.querySelector('output[data-status]')?.getAttribute('data-status') ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  api.prepareReading.mockReset();
  setModel = null;
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanup();
});

describe('§22 reader button', () => {
  it('knows a prepared page', () => {
    expect(isPagePrepared(pageModel())).toBe(false);
    expect(isPagePrepared(pageModel("1. Lis l'article. 2. Souligne les verbes."))).toBe(true);
    expect(isPagePrepared(pageModel('Autre chose.'))).toBe(false);
    expect(isPagePrepared(undefined)).toBe(false);
  });

  it('sends the page on screen, waits for the synchronization, then says it is ready', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    api.prepareReading.mockResolvedValue({ queued: 1, unavailable: null });
    const container = await render(<Harness initial={pageModel()} />);
    expect(buttonByText(p.button, container)).not.toBeNull();

    await click(buttonByText(p.button, container));
    await waitFor(() => expect(statusOf(container)).toBe('waiting'));
    expect(api.prepareReading).toHaveBeenCalledWith('d1', { pageIndexes: [4] });
    expect(notify.info).toHaveBeenCalledWith(p.queued);
    expect(buttonByText(p.busy, container)?.disabled).toBe(true);

    vi.advanceTimersByTime(PREPARATION_POLL_MS);
    expect(api.syncNow).toHaveBeenCalledTimes(1);

    setModel?.(pageModel("1. Lis l'article. 2. Souligne les verbes."));
    await waitFor(() => expect(statusOf(container)).toBe('ready'));
    expect(notify.success).toHaveBeenCalledWith(p.ready);
    expect(buttonByText(p.done, container)?.disabled).toBe(true);
  });

  it('gives up waiting after a while, and explains when the help is not available', async () => {
    // Fake clock that still moves on its own (the DOM helpers wait with real delays).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], shouldAdvanceTime: true });
    api.prepareReading.mockResolvedValueOnce({ queued: 0, unavailable: null }).mockResolvedValueOnce({ queued: 0, unavailable: 'not_configured' });
    const container = await render(<Harness initial={pageModel()} />);
    await click(buttonByText(p.button, container));
    await waitFor(() => expect(statusOf(container)).toBe('waiting'));
    expect(notify.info).toHaveBeenCalledWith(p.already);
    await act(async () => {
      vi.advanceTimersByTime(PREPARATION_WAIT_MS + 1);
    });
    await waitFor(() => expect(statusOf(container)).toBe('idle'));
    expect(notify.info).toHaveBeenCalledWith(p.later);

    await click(buttonByText(p.button, container));
    await waitFor(() => expect(notify.info).toHaveBeenCalledWith(p.unavailable));
    expect(statusOf(container)).toBe('idle');
  });

  it('warns when the request fails', async () => {
    const { ApiError } = await import('../../src/api/http');
    api.prepareReading.mockRejectedValueOnce(new ApiError(0, 'offline', 'offline')).mockRejectedValueOnce(new Error('boom'));
    const container = await render(<Harness initial={pageModel()} />);
    await click(buttonByText(p.button, container));
    await waitFor(() => expect(notify.warning).toHaveBeenCalledWith(p.offline));
    await waitFor(() => expect(buttonByText(p.button, container)?.disabled).toBe(false));
    await click(buttonByText(p.button, container));
    await waitFor(() => expect(notify.warning).toHaveBeenCalledWith(p.failed));
    expect(statusOf(container)).toBe('idle');
  });
});
