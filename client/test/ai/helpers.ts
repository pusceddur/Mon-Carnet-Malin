import {
  DEFAULT_EXERCISE_PREFERENCES,
  DEFAULT_READING_PREFERENCES,
  DEFAULT_TTS_PREFERENCES,
  PROMPT_VERSION,
  type AIMeta,
  type AIPageInput,
  type ChildProfile,
} from '@aide/shared';
import { vi } from 'vitest';

export const HASH = 'a'.repeat(64);

export function makeChild(overrides: Partial<ChildProfile> = {}): ChildProfile {
  return {
    id: 'child-1',
    parentId: 'parent-1',
    nickname: 'Léo',
    avatar: '🦊',
    readingLevel: 'intermediaire',
    explanationDifficulty: 'simple',
    reading: { ...DEFAULT_READING_PREFERENCES },
    tts: { ...DEFAULT_TTS_PREFERENCES },
    exercises: { ...DEFAULT_EXERCISE_PREFERENCES },
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  };
}

export function meta(overrides: Partial<AIMeta> = {}): AIMeta {
  return { cached: false, route: 'light', promptVersion: PROMPT_VERSION, sourceWarning: false, requestId: 'req-1', ...overrides };
}

export function page(pageIndex: number, text: string, ocrLowConfidence = false): AIPageInput {
  return { pageIndex, text, contentHash: HASH, ocrLowConfidence };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

export interface FetchCall { method: string; url: string; body: unknown }

/** fetch mock routed by a handler; records calls with parsed JSON bodies. */
export function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>): { calls: FetchCall[]; fn: ReturnType<typeof vi.fn> } {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = {
      method: init?.method ?? 'GET',
      url: String(input),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}
