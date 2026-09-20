import { extractiveSummary, type AIPageInput, type SummaryData, type TextChunk } from '@aide/shared';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { summarizeProgressively } from '../../src/ai/aiClient';
import { db } from '../../src/db/localDb';
import { useSessionStore } from '../../src/state/session';
import { HASH, json, makeChild, meta, mockFetch, page, setOnline, type FetchCall } from './helpers';

const extractive: SummaryData = { summary: 'Le chat dort. Le chien joue.', keyPoints: [], sourceRefs: [{ pageIndex: 0, quote: 'Le chat dort.' }] };

vi.mock('@aide/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aide/shared')>();
  return {
    ...actual,
    // One chunk per page (deterministic, independent from the shared-core implementation).
    planChunks: vi.fn(async (pages: AIPageInput[]): Promise<TextChunk[]> =>
      pages.map((p, chunkIndex) => ({ chunkIndex, pageIndexes: [p.pageIndex], text: p.text, contentHash: HASH }))),
    extractiveSummary: vi.fn(() => extractive),
  };
});

const request = {
  childId: 'child-1', documentId: 'doc-1', documentHash: HASH, level: 'normal' as const,
  pages: [page(0, 'Le chat dort.'), page(1, 'Le chien joue.', true), page(2, 'La pluie tombe.')],
};

const finalData: SummaryData = { summary: 'Des animaux et de la pluie.', keyPoints: ['Le chat dort'], sourceRefs: [{ pageIndex: 0, quote: 'Le chat dort.' }] };

interface SummarizeBody { stage: { kind: 'chunk'; chunk: TextChunk; planHash: string } | { kind: 'final'; chunkCount: number; planHash: string }; ocrLowConfidence: boolean }

const stageOf = (call: FetchCall): SummarizeBody['stage'] => (call.body as SummarizeBody).stage;

function chunkReply(call: FetchCall): Response {
  const stage = stageOf(call);
  if (stage.kind !== 'chunk') throw new Error('expected a chunk stage');
  return json({
    status: 'ok',
    data: { chunkIndex: stage.chunk.chunkIndex, summary: `Résumé ${stage.chunk.chunkIndex}`, keyQuotes: [{ pageIndex: stage.chunk.pageIndexes[0], quote: stage.chunk.text }] },
    meta: meta(),
  });
}

describe('summarizeProgressively', () => {
  beforeEach(async () => {
    setOnline(true);
    useSessionStore.setState({ children: [makeChild()], parentSettings: null });
    await db.aiCache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    db.close();
  });

  it('sends every chunk with at most 2 in flight, reports progress, then the final stage', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { calls } = mockFetch(async (call) => {
      if (stageOf(call).kind === 'final') return json({ status: 'pending', jobId: 'job-s', pollAfterMs: 1 }, 202);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return chunkReply(call);
    });
    // Poll replies come through the same mock: GET has no body.
    const fetchFn = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('/api/ai/jobs/')) return json({ status: 'ok', data: finalData, meta: meta({ route: 'complex' }) });
      return fetchFn(input, init);
    });

    const progress: [number, number][] = [];
    const result = await summarizeProgressively(request, (done, total) => progress.push([done, total]));

    expect(result).toEqual({ status: 'ok', data: finalData, meta: meta({ route: 'complex' }) });
    expect(maxInFlight).toBe(2);
    const chunkCalls = calls.filter((c) => stageOf(c).kind === 'chunk');
    expect(chunkCalls).toHaveLength(3);
    const planHashes = new Set(calls.map((c) => stageOf(c).planHash));
    expect(planHashes.size).toBe(1);
    expect(chunkCalls.find((c) => stageOf(c).kind === 'chunk' && (stageOf(c) as { chunk: TextChunk }).chunk.chunkIndex === 1)?.body)
      .toMatchObject({ ocrLowConfidence: true });
    expect(calls.at(-1)?.body).toMatchObject({ stage: { kind: 'final', chunkCount: 3 }, ocrLowConfidence: true, level: 'normal' });
    expect(progress[0]).toEqual([0, 4]);
    expect(progress.at(-1)).toEqual([4, 4]);
  });

  it('re-sends the missing chunks (bypassing the local cache) and retries the final stage', async () => {
    let finals = 0;
    const { calls } = mockFetch((call) => {
      const stage = stageOf(call);
      if (stage.kind === 'chunk') return chunkReply(call);
      finals += 1;
      if (finals === 1) return json({ status: 'unavailable', reason: 'missing_chunks', message: '', meta: null, missingChunkIndexes: [2] });
      return json({ status: 'ok', data: finalData, meta: meta() });
    });
    const result = await summarizeProgressively(request, () => {});
    expect(result.status).toBe('ok');
    const chunkIndexes = calls
      .map((c) => stageOf(c))
      .filter((s): s is Extract<SummarizeBody['stage'], { kind: 'chunk' }> => s.kind === 'chunk')
      .map((s) => s.chunk.chunkIndex);
    expect(chunkIndexes.sort()).toEqual([0, 1, 2, 2]);
    expect(finals).toBe(2);
  });

  it('offline → unavailable, nothing is summarized on the device (decision 2026-09-19)', async () => {
    setOnline(false);
    const { fn } = mockFetch(() => json({}));
    const progress: [number, number][] = [];
    const result = await summarizeProgressively(request, (d, t) => progress.push([d, t]));
    expect(result).toMatchObject({ status: 'unavailable', reason: 'offline' });
    expect(fn).not.toHaveBeenCalled();
    expect(extractiveSummary).not.toHaveBeenCalled();
    expect(progress.at(-1)).toEqual([4, 4]);
  });

  it('a chunk the server cannot handle → unavailable; a blocked chunk does not stop the summary', async () => {
    mockFetch((call) => {
      const stage = stageOf(call);
      if (stage.kind === 'chunk' && stage.chunk.chunkIndex === 1) return json({ error: { code: 'internal', message: 'x' } }, 500);
      return chunkReply(call);
    });
    expect(await summarizeProgressively(request, () => {})).toMatchObject({ status: 'unavailable' });

    await db.aiCache.clear();
    mockFetch((call) => {
      const stage = stageOf(call);
      if (stage.kind === 'final') return json({ status: 'ok', data: finalData, meta: meta({ sourceWarning: true }) });
      if (stage.chunk.chunkIndex === 0) return json({ status: 'blocked', reason: 'safety_output', message: 'Non', meta: meta() });
      return chunkReply(call);
    });
    expect(await summarizeProgressively(request, () => {})).toMatchObject({ status: 'ok', data: finalData, meta: { sourceWarning: true } });
  });

  it('returns a blocked final result as is', async () => {
    mockFetch((call) => (stageOf(call).kind === 'final'
      ? json({ status: 'blocked', reason: 'validation', message: 'Je ne peux pas t’aider.', meta: meta() })
      : chunkReply(call)));
    expect(await summarizeProgressively(request, () => {})).toMatchObject({ status: 'blocked', reason: 'validation' });
  });

  it('pages without text → not_in_text without network', async () => {
    const { fn } = mockFetch(() => json({}));
    const result = await summarizeProgressively({ ...request, pages: [page(0, '   ')] }, () => {});
    expect(result.status).toBe('not_in_text');
    expect(fn).not.toHaveBeenCalled();
  });
});
