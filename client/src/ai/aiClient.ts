// Client side of the AI layer (§11.6, §15.4). Every function resolves; nothing throws towards the UI.
// Order of requestAI: local cache → offline check → server (sync result or 202 job + polling) → local fallbacks.
import {
  AI_DEADLINES,
  AIDataSchemaByOperation,
  AIResultSchema,
  DEFAULT_PARENT_SETTINGS,
  DictionaryResultSchema,
  KID_MESSAGES,
  LIMITS,
  PROMPT_VERSION,
  TIMINGS,
  extractiveSummary,
  generateLocalQuestions,
  lookupGlossary,
  newId,
  planChunks,
  planHash,
  profileSignature,
  routeFor,
  sha256Hex,
  type AIMeta,
  type AIOperation,
  type AIPageInput,
  type AIResult,
  type AIRoute,
  type AIUnavailableReason,
  type ChildProfile,
  type DataFor,
  type DictionaryResult,
  type ExplanationData,
  type GlossaryEntry,
  type QuestionsData,
  type RequestFor,
  type SummarizeRequest,
  type SummaryData,
  type TextChunk,
} from '@aide/shared';
import { getAIJob, postAI } from '../api/ai';
import { getDictionary } from '../api/dictionary';
import { ApiError } from '../api/http';
import { db, type DictionaryCacheRecord } from '../db/localDb';
import { isOnline } from '../platform/online';
import { useSessionStore } from '../state/session';

type Result<Op extends AIOperation> = AIResult<DataFor<Op>>;

interface InternalOptions {
  signal?: AbortSignal;
  /** Skip the local cache read (chunks re-sent after `missing_chunks`). */
  bypassCache?: boolean;
  /** No local fallback (the caller has its own). */
  noFallback?: boolean;
}

export const AI_CACHE_TTL_MS = 30 * 24 * 60 * 60_000;
export const DICTIONARY_NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60_000;
const POLL_MIN_MS = 100;
const POLL_MAX_MS = 15_000;
const MAX_TRANSIENT_POLL_ERRORS = 3;
const MAX_MISSING_CHUNK_RETRIES = 2;
/** Upper bound of a server-provided `AIJobAccepted.waitMs` (external worker deadlines, §17.4). */
const MAX_JOB_WAIT_MS = 15 * 60_000;

// ---------- results ----------

export function kidMessageForUnavailable(reason: AIUnavailableReason): string {
  switch (reason) {
    case 'offline':
      return KID_MESSAGES.offline;
    case 'quota':
      return KID_MESSAGES.quota;
    case 'budget':
      return KID_MESSAGES.budget;
    default:
      return KID_MESSAGES.unavailable;
  }
}

function unavailable<T>(reason: AIUnavailableReason): AIResult<T> {
  return { status: 'unavailable', reason, message: kidMessageForUnavailable(reason), meta: null };
}

function localMeta(sourceWarning: boolean): AIMeta {
  return { cached: false, route: 'local', promptVersion: PROMPT_VERSION, sourceWarning, requestId: newId() };
}

const resultSchemas = new Map<AIOperation, ReturnType<typeof buildResultSchema>>();

function buildResultSchema(op: AIOperation) {
  return AIResultSchema(AIDataSchemaByOperation[op]);
}

function parseResult<Op extends AIOperation>(op: Op, raw: unknown): Result<Op> | null {
  let schema = resultSchemas.get(op);
  if (!schema) {
    schema = buildResultSchema(op);
    resultSchemas.set(op, schema);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  const result = parsed.data as unknown as Result<Op>;
  if (result.status === 'unavailable' && result.message.trim() === '') return { ...result, message: kidMessageForUnavailable(result.reason) };
  if (result.status === 'not_in_text' && result.message.trim() === '') return { ...result, message: KID_MESSAGES.notInText };
  if (result.status === 'blocked' && result.message.trim() === '') {
    return { ...result, message: result.reason === 'adult_redirect' ? KID_MESSAGES.adultRedirect : KID_MESSAGES.blocked };
  }
  return result;
}

function isPending(raw: unknown): raw is { status: 'pending'; pollAfterMs?: unknown; jobId?: unknown; waitMs?: unknown } {
  return typeof raw === 'object' && raw !== null && (raw as { status?: unknown }).status === 'pending';
}

function pollDelay(value: unknown): number {
  const ms = typeof value === 'number' && Number.isFinite(value) ? value : TIMINGS.aiJobPollMs;
  return Math.min(POLL_MAX_MS, Math.max(POLL_MIN_MS, ms));
}

/** Valid `waitMs` of a 202 answer, null when absent or invalid. */
function jobWaitMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(value, MAX_JOB_WAIT_MS);
}

function errorReason(error: unknown, signal: AbortSignal | undefined): AIUnavailableReason {
  if (signal?.aborted) return 'timeout';
  if (!(error instanceof ApiError)) return 'provider_error';
  if (error.code === 'offline') return 'offline';
  if (error.code === 'timeout' || error.code === 'aborted') return 'timeout';
  if (error.status === 413 || error.code === 'payload_too_large') return 'payload_too_large';
  if (error.status === 429 || error.status === 503 || error.code === 'busy') return 'busy';
  return 'provider_error';
}

function isTransientPollError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.code === 'timeout' || error.code === 'offline' || error.status === 429 || error.status >= 500;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------- cache ----------

/** JSON with keys sorted recursively and strings in NFC (cache key input). */
export function stableStringify(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

type Learner = Pick<ChildProfile, 'age' | 'readingLevel' | 'explanationDifficulty'>;

async function findLearner(childId: string): Promise<Learner | null> {
  const fromStore = useSessionStore.getState().children.find((c) => c.id === childId);
  if (fromStore) return fromStore;
  try {
    return (await db.children.get(childId)) ?? null;
  } catch {
    return null;
  }
}

/** sha256 of op + body (without childId) + profile signature + PROMPT_VERSION. */
export async function localAICacheKey<Op extends AIOperation>(op: Op, body: RequestFor<Op>): Promise<string> {
  const { childId, ...rest } = body;
  const learner = await findLearner(childId);
  const signature = learner ? profileSignature(learner) : 'unknown';
  return sha256Hex(stableStringify({ op, body: rest, profile: signature, promptVersion: PROMPT_VERSION }));
}

let pruned = false;

function pruneAICacheOnce(): void {
  if (pruned) return;
  pruned = true;
  db.aiCache.where('createdAt').below(Date.now() - AI_CACHE_TTL_MS).delete().catch(() => undefined);
}

async function readAICache<Op extends AIOperation>(key: string, op: Op): Promise<Result<Op> | null> {
  try {
    const record = await db.aiCache.get(key);
    if (!record || record.operation !== op) return null;
    if (Date.now() - record.createdAt > AI_CACHE_TTL_MS) return null;
    const parsed = parseResult(op, record.result);
    if (!parsed || (parsed.status !== 'ok' && parsed.status !== 'not_in_text')) return null;
    return { ...parsed, meta: { ...parsed.meta, cached: true } };
  } catch {
    return null;
  }
}

async function writeAICache<Op extends AIOperation>(key: string, op: Op, result: Result<Op>): Promise<void> {
  if (result.status !== 'ok' && result.status !== 'not_in_text') return;
  // Local answers are not cached: once the AI is back, the real answer must win.
  if (result.meta.route === 'local') return;
  try {
    await db.aiCache.put({ key, operation: op, result: result as AIResult<unknown>, createdAt: Date.now() });
  } catch {
    // Cache is an optimisation.
  }
}

// ---------- routing estimate (timeouts only; the server decides) ----------

function totalChars(pages: readonly AIPageInput[]): number {
  return pages.reduce((n, p) => n + p.text.length, 0);
}

function inputCharsOf(op: AIOperation, body: RequestFor<AIOperation>): number {
  switch (op) {
    case 'explain_text':
      return (body as RequestFor<'explain_text'>).text.length;
    case 'simplify_text':
      return (body as RequestFor<'simplify_text'>).text.length;
    case 'summarize': {
      const stage = (body as RequestFor<'summarize'>).stage;
      return stage.kind === 'chunk' ? stage.chunk.text.length : 0;
    }
    case 'generate_questions':
      return totalChars((body as RequestFor<'generate_questions'>).pages);
    case 'question_on_text':
      return Math.min(LIMITS.retrieveMaxChars, totalChars((body as RequestFor<'question_on_text'>).pages));
    case 'correct_answer':
      return (body as RequestFor<'correct_answer'>).answerText.length;
    default:
      return 0;
  }
}

function estimateRoute(op: AIOperation, body: RequestFor<AIOperation>): AIRoute {
  const settings = useSessionStore.getState().parentSettings ?? DEFAULT_PARENT_SETTINGS;
  const stage = op === 'summarize' ? (body as RequestFor<'summarize'>).stage.kind : undefined;
  return routeFor(op, inputCharsOf(op, body), settings, stage ? { summarizeStage: stage } : undefined);
}

function clientTimeout(route: AIRoute): number {
  return (route === 'complex' ? AI_DEADLINES.complex : AI_DEADLINES.light) + TIMINGS.aiClientTimeoutMarginMs;
}

// ---------- server ----------

async function pollJob<Op extends AIOperation>(op: Op, jobId: string, firstDelay: unknown, deadlineAt: number, signal: AbortSignal | undefined): Promise<Result<Op>> {
  let delay = pollDelay(firstDelay);
  let transientErrors = 0;
  for (;;) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return unavailable('timeout');
    if (!(await sleep(Math.min(delay, remaining), signal))) return unavailable('timeout');
    if (Date.now() >= deadlineAt) return unavailable('timeout');
    if (!isOnline()) return unavailable('offline');
    let raw: unknown;
    try {
      raw = await getAIJob<Op>(jobId, { signal, timeoutMs: Math.max(1000, Math.min(deadlineAt - Date.now(), 30_000)) });
    } catch (error) {
      if (!signal?.aborted && isTransientPollError(error) && transientErrors < MAX_TRANSIENT_POLL_ERRORS && isOnline()) {
        transientErrors += 1;
        delay = pollDelay(TIMINGS.aiJobPollMs);
        continue;
      }
      return unavailable(errorReason(error, signal));
    }
    if (isPending(raw)) {
      delay = pollDelay(raw.pollAfterMs);
      continue;
    }
    return parseResult(op, raw) ?? unavailable('provider_error');
  }
}

async function callServer<Op extends AIOperation>(op: Op, body: RequestFor<Op>, signal: AbortSignal | undefined): Promise<Result<Op>> {
  const startedAt = Date.now();
  let deadlineAt = startedAt + clientTimeout(estimateRoute(op, body));
  let raw: unknown;
  try {
    raw = await postAI(op, body, { signal, timeoutMs: Math.max(1000, deadlineAt - Date.now()) });
  } catch (error) {
    return unavailable(errorReason(error, signal));
  }
  if (isPending(raw)) {
    if (typeof raw.jobId !== 'string' || raw.jobId === '') return unavailable('provider_error');
    // The server tells how long the job may take (external worker, §17.4); otherwise a job is always a complex route.
    const waitMs = jobWaitMs(raw.waitMs);
    deadlineAt = waitMs !== null ? startedAt + waitMs : Math.max(deadlineAt, startedAt + clientTimeout('complex'));
    return pollJob(op, raw.jobId, raw.pollAfterMs, deadlineAt, signal);
  }
  return parseResult(op, raw) ?? unavailable('provider_error');
}

// ---------- local fallbacks ----------

function cleanWord(word: string): string {
  const clean = word.normalize('NFC').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return clean.length > LIMITS.wordMaxChars ? '' : clean;
}

function dictionaryKey(word: string): string {
  return word.toLocaleLowerCase('fr');
}

async function parentGlossary(): Promise<GlossaryEntry[]> {
  try {
    return await db.glossary.toArray();
  } catch {
    return [];
  }
}

async function readDictionaryCache(key: string): Promise<DictionaryCacheRecord | null> {
  try {
    return (await db.dictionaryCache.get(key)) ?? null;
  } catch {
    return null;
  }
}

export interface LocalExplanation { headword: string; definition: string; example: string | null }

/** Kid-friendly definition available without network: parent + built-in glossary, then kid-friendly cached entries. */
export async function lookupLocalExplanation(word: string): Promise<LocalExplanation | null> {
  try {
    const clean = cleanWord(word);
    if (clean === '') return null;
    const local = lookupGlossary(clean, await parentGlossary());
    if (local) return { headword: local.entry.headword, definition: local.entry.kidDefinition, example: local.entry.example };
    const cached = await readDictionaryCache(dictionaryKey(clean));
    if (cached?.result.status === 'found' && cached.result.entry.kidFriendly) {
      const { entry } = cached.result;
      return { headword: entry.headword, definition: entry.definition, example: entry.example };
    }
    return null;
  } catch {
    return null;
  }
}

async function localFallback<Op extends AIOperation>(op: Op, body: RequestFor<Op>): Promise<Result<Op> | null> {
  switch (op) {
    case 'explain_word': {
      const request = body as RequestFor<'explain_word'>;
      const local = await lookupLocalExplanation(request.word);
      if (!local) return null;
      const data: ExplanationData = { explanation: local.definition, example: local.example, sourceQuotes: [] };
      const result: AIResult<ExplanationData> = { status: 'ok', data, meta: localMeta(request.ocrLowConfidence) };
      return result as Result<Op>;
    }
    case 'generate_questions': {
      const request = body as RequestFor<'generate_questions'>;
      const questions = generateLocalQuestions(request.pages, request.count, request.types);
      if (questions.length === 0) return null;
      const result: AIResult<QuestionsData> = {
        status: 'ok',
        data: { questions },
        meta: localMeta(request.pages.some((p) => p.ocrLowConfidence)),
      };
      return result as Result<Op>;
    }
    default:
      return null;
  }
}

// ---------- public API ----------

async function requestAIWith<Op extends AIOperation>(op: Op, body: RequestFor<Op>, opts: InternalOptions): Promise<Result<Op>> {
  try {
    if (opts.signal?.aborted) return unavailable('timeout');
    pruneAICacheOnce();
    // Handwriting images and their text are never cached (§15.4).
    const key = op === 'recognize_handwriting' ? null : await localAICacheKey(op, body).catch(() => null);
    if (key && !opts.bypassCache) {
      const hit = await readAICache(key, op);
      if (hit) return hit;
    }
    const result = isOnline() ? await callServer(op, body, opts.signal) : unavailable<DataFor<Op>>('offline');
    if (result.status === 'unavailable') {
      if (opts.noFallback || opts.signal?.aborted) return result;
      return (await localFallback(op, body)) ?? result;
    }
    if (key) await writeAICache(key, op, result);
    return result;
  } catch {
    return unavailable('provider_error');
  }
}

/**
 * offline → unavailable/offline immediately (after the local cache); timeout = AI_DEADLINES[route] + 15 s, 202 jobs polled
 * until that deadline (or until start + `waitMs` when the 202 answer gives one); errors → unavailable. Local fallbacks: explain_word (glossary / cached dictionary),
 * generate_questions (generateLocalQuestions, `meta.route === 'local'` ⇒ Exercise.origin 'local'). Never throws.
 */
export async function requestAI<Op extends AIOperation>(op: Op, body: RequestFor<Op>, opts?: { signal?: AbortSignal }): Promise<AIResult<DataFor<Op>>> {
  return requestAIWith(op, body, { signal: opts?.signal });
}

async function runPool<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>, shouldStop: (result: R) => boolean): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  let stopped = false;
  const lane = async (): Promise<void> => {
    while (!stopped) {
      const index = next;
      next += 1;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      const result = await worker(item);
      results.push(result);
      if (shouldStop(result)) stopped = true;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => lane()));
  return results;
}

function isSummaryData(data: unknown): data is SummaryData {
  return typeof data === 'object' && data !== null && typeof (data as SummaryData).summary === 'string'
    && Array.isArray((data as SummaryData).keyPoints) && Array.isArray((data as SummaryData).sourceRefs);
}

function localSummary(pages: AIPageInput[], level: SummarizeRequest['level'], sourceWarning: boolean, reasonIfEmpty: AIUnavailableReason): AIResult<SummaryData> {
  try {
    const data = extractiveSummary(pages, level);
    if (data.summary.trim() === '') return unavailable(reasonIfEmpty);
    return { status: 'ok', data, meta: localMeta(sourceWarning) };
  } catch {
    return unavailable(reasonIfEmpty);
  }
}

/**
 * Client-orchestrated progressive summary (C7, §15.4): planChunks + planHash → one light request per chunk (at most
 * LIMITS.summarizeChunkParallelism in flight, progress `done/total` with total = chunks + 1 final step) → final request
 * (async job). `missing_chunks` → the listed chunks are sent again (cache bypassed) and the final is retried.
 * Offline / AI unavailable → deterministic extractive summary (`meta.route === 'local'`). Never throws.
 */
export async function summarizeProgressively(
  req: Omit<SummarizeRequest, 'stage' | 'ocrLowConfidence'> & { pages: AIPageInput[] },
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<AIResult<SummaryData>> {
  const report = (done: number, total: number): void => {
    try {
      onProgress(done, total);
    } catch {
      // A failing progress callback must not break the summary.
    }
  };
  try {
    const base = { childId: req.childId, documentId: req.documentId, documentHash: req.documentHash, level: req.level };
    const pages = req.pages.filter((p) => p.text.trim() !== '');
    if (pages.length === 0) return { status: 'not_in_text', message: KID_MESSAGES.notInText, meta: localMeta(false) };
    const sourceWarning = pages.some((p) => p.ocrLowConfidence);
    const chunks = await planChunks(pages);
    const total = chunks.length + 1;
    let done = 0;
    report(done, total);

    const fallback = (reason: AIUnavailableReason): AIResult<SummaryData> => {
      if (signal?.aborted) return unavailable('timeout');
      const local = localSummary(pages, req.level, sourceWarning, reason);
      report(total, total);
      return local;
    };
    if (signal?.aborted) return unavailable('timeout');
    if (!isOnline()) return fallback('offline');

    const hash = await planHash(chunks);
    const lowConfidence = new Map(pages.map((p) => [p.pageIndex, p.ocrLowConfidence]));
    const sendChunks = async (list: readonly TextChunk[], bypassCache: boolean, countProgress: boolean): Promise<AIUnavailableReason | null> => {
      const results = await runPool(
        list,
        LIMITS.summarizeChunkParallelism,
        async (chunk) => {
          const result = await requestAIWith(
            'summarize',
            {
              ...base,
              stage: { kind: 'chunk', planHash: hash, chunk },
              ocrLowConfidence: chunk.pageIndexes.some((i) => lowConfidence.get(i) === true),
            },
            { signal, bypassCache, noFallback: true },
          );
          if (countProgress) {
            done += 1;
            report(done, total);
          }
          return result;
        },
        (result) => result.status === 'unavailable',
      );
      // Blocked chunks are excluded by the server at the final stage: only unavailability stops the summary.
      const failure = results.find((r) => r.status === 'unavailable');
      return failure && failure.status === 'unavailable' ? failure.reason : null;
    };

    const chunkFailure = await sendChunks(chunks, false, true);
    if (chunkFailure) return fallback(chunkFailure);

    for (let attempt = 0; attempt <= MAX_MISSING_CHUNK_RETRIES; attempt += 1) {
      const final = await requestAIWith(
        'summarize',
        { ...base, stage: { kind: 'final', planHash: hash, chunkCount: chunks.length }, ocrLowConfidence: sourceWarning },
        { signal, noFallback: true },
      );
      if (final.status === 'unavailable') {
        if (final.reason === 'missing_chunks' && attempt < MAX_MISSING_CHUNK_RETRIES) {
          const wanted = new Set(final.missingChunkIndexes ?? []);
          const missing = chunks.filter((c) => wanted.has(c.chunkIndex));
          const retryFailure = await sendChunks(missing.length > 0 ? missing : chunks, true, false);
          if (retryFailure) return fallback(retryFailure);
          continue;
        }
        return fallback(final.reason);
      }
      report(total, total);
      if (final.status === 'ok') {
        if (!isSummaryData(final.data)) return fallback('provider_error');
        return { status: 'ok', data: final.data, meta: final.meta };
      }
      return final;
    }
    return fallback('missing_chunks');
  } catch {
    return unavailable('provider_error');
  }
}

function isFreshDictionaryRecord(record: DictionaryCacheRecord): boolean {
  if (record.result.status === 'found') return true;
  if (record.result.status === 'not_found') return Date.now() - record.fetchedAt < DICTIONARY_NOT_FOUND_TTL_MS;
  return false;
}

/** Local glossary (parent entries in Dexie, then built-in) → dictionaryCache → /api/dictionary. Never throws. */
export async function lookupDefinition(word: string): Promise<DictionaryResult> {
  try {
    const clean = cleanWord(word);
    if (clean === '') return { status: 'not_found' };
    const local = lookupGlossary(clean, await parentGlossary());
    if (local) {
      return {
        status: 'found',
        entry: {
          headword: local.entry.headword,
          lemma: local.lemma,
          partOfSpeech: local.entry.partOfSpeech,
          definition: local.entry.kidDefinition,
          example: local.entry.example,
          source: local.source,
          attribution: null,
          kidFriendly: true,
        },
      };
    }
    const key = dictionaryKey(clean);
    const cached = await readDictionaryCache(key);
    if (cached && isFreshDictionaryRecord(cached)) return cached.result;
    if (!isOnline()) return cached?.result ?? { status: 'unavailable' };

    let remote: DictionaryResult = { status: 'unavailable' };
    try {
      const parsed = DictionaryResultSchema.safeParse(await getDictionary(clean));
      if (parsed.success) remote = parsed.data;
    } catch {
      remote = { status: 'unavailable' };
    }
    if (remote.status === 'unavailable') return cached?.result ?? remote;
    try {
      await db.dictionaryCache.put({ word: key, result: remote, fetchedAt: Date.now() });
    } catch {
      // Cache is an optimisation.
    }
    return remote;
  } catch {
    return { status: 'unavailable' };
  }
}
