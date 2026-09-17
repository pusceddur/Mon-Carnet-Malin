import type { OcrServerResult } from '@aide/shared';
import { silentLogger, type Logger } from '../logger';
import { pageCharCount, pageConfidence, pageToTextBlocks, type OcrPage } from './layout';

/** Page segmentation modes used: 3 = automatic layout, 6 = single uniform block. */
export type OcrPsm = '3' | '6';

/** One loaded recognizer (a tesseract.js worker in production, a fake in tests). */
export interface OcrEngine {
  recognize(image: Uint8Array, psm: OcrPsm): Promise<OcrPage>;
  terminate(): Promise<void>;
  /** False once the underlying worker crashed. */
  isAlive?(): boolean;
}

export type OcrEngineFactory = () => Promise<OcrEngine>;

export type OcrErrorKind = 'busy' | 'timeout' | 'unavailable' | 'invalid_image' | 'failed' | 'aborted';

export class OcrError extends Error {
  readonly kind: OcrErrorKind;
  readonly retryAfterSeconds: number | null;

  constructor(kind: OcrErrorKind, retryAfterSeconds: number | null = null) {
    super(`ocr_${kind}`);
    this.name = 'OcrError';
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const SERVER_OCR_DEFAULTS = {
  idleTimeoutMs: 5 * 60_000,
  /** From acceptance (queue wait included) to response. */
  deadlineMs: 90_000,
  /** The PSM 6 pass only starts if the PSM 3 pass ended before this delay. */
  secondPassMaxElapsedMs: 40_000,
  lowConfidence: 70,
  /** Jobs waiting behind the running one. */
  maxQueue: 3,
  /** A queued job that has less time left than this is refused instead of started. */
  minStartBudgetMs: 10_000,
  initFailureCooldownMs: 5 * 60_000,
  expectedJobMs: 20_000,
} as const;

export interface ServerOcrOptions {
  engineFactory: OcrEngineFactory;
  /** Model files present? Checked for health and before accepting a job. */
  isModelAvailable?: () => boolean;
  logger?: Logger;
  now?: () => number;
  idleTimeoutMs?: number;
  deadlineMs?: number;
  secondPassMaxElapsedMs?: number;
  lowConfidence?: number;
  maxQueue?: number;
  minStartBudgetMs?: number;
  initFailureCooldownMs?: number;
}

export interface ServerOcrStatus {
  available: boolean;
  busy: boolean;
  running: boolean;
  queued: number;
  engineLoaded: boolean;
}

/** Contract used by the route (tests inject fakes). */
export interface ServerOcrLike {
  recognize(image: Uint8Array, options?: { signal?: AbortSignal }): Promise<OcrServerResult>;
  status(): ServerOcrStatus;
  retryAfterSeconds(): number;
}

interface Job {
  image: Uint8Array;
  acceptedAt: number;
  signal: AbortSignal | undefined;
  resolve: (result: OcrServerResult) => void;
  reject: (error: OcrError) => void;
  onAbort: (() => void) | null;
}

interface Pass {
  page: OcrPage;
  confidence: number;
  chars: number;
}

/** PSM 6 wins only when clearly more confident and not dropping a large part of the text. */
export function pickBetterPass<T extends { confidence: number; chars: number }>(first: T, second: T): T {
  if (first.chars === 0) return second.chars > 0 ? second : first;
  if (second.chars === 0) return first;
  return second.confidence > first.confidence + 1 && second.chars >= first.chars * 0.6 ? second : first;
}

function isImageDecodeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /read image|pixReadMem|image file/i.test(message);
}

/**
 * Server-side OCR (§15.6): one lazily created engine, one job at a time + a queue of 3, PSM 3 then PSM 6 when the
 * confidence is low and time allows, 90 s deadline (the engine is killed when it is exceeded), engine stopped after
 * 5 minutes of inactivity. Images only live in memory for the duration of the job.
 */
export class ServerOCR implements ServerOcrLike {
  private readonly opts: Required<Omit<ServerOcrOptions, 'isModelAvailable'>> & Pick<ServerOcrOptions, 'isModelAvailable'>;
  private engine: OcrEngine | null = null;
  private enginePromise: Promise<OcrEngine> | null = null;
  /** Incremented when a pending engine start must be abandoned (deadline hit while loading). */
  private engineGeneration = 0;
  private running = false;
  private readonly queue: Job[] = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private initFailedAt: number | null = null;
  private averageJobMs: number = SERVER_OCR_DEFAULTS.expectedJobMs;
  private stopped = false;

  constructor(options: ServerOcrOptions) {
    this.opts = {
      engineFactory: options.engineFactory,
      isModelAvailable: options.isModelAvailable,
      logger: options.logger ?? silentLogger,
      now: options.now ?? (() => Date.now()),
      idleTimeoutMs: options.idleTimeoutMs ?? SERVER_OCR_DEFAULTS.idleTimeoutMs,
      deadlineMs: options.deadlineMs ?? SERVER_OCR_DEFAULTS.deadlineMs,
      secondPassMaxElapsedMs: options.secondPassMaxElapsedMs ?? SERVER_OCR_DEFAULTS.secondPassMaxElapsedMs,
      lowConfidence: options.lowConfidence ?? SERVER_OCR_DEFAULTS.lowConfidence,
      maxQueue: options.maxQueue ?? SERVER_OCR_DEFAULTS.maxQueue,
      minStartBudgetMs: options.minStartBudgetMs ?? SERVER_OCR_DEFAULTS.minStartBudgetMs,
      initFailureCooldownMs: options.initFailureCooldownMs ?? SERVER_OCR_DEFAULTS.initFailureCooldownMs,
    };
  }

  status(): ServerOcrStatus {
    return {
      available: this.isAvailable(),
      busy: this.isFull(),
      running: this.running,
      queued: this.queue.length,
      engineLoaded: this.engine !== null,
    };
  }

  /** Seconds a refused client should wait, from the observed job duration. */
  retryAfterSeconds(): number {
    const pending = this.queue.length + (this.running ? 1 : 0);
    const seconds = Math.ceil(((pending || 1) * this.averageJobMs) / 1000);
    return Math.min(120, Math.max(5, seconds));
  }

  recognize(image: Uint8Array, options: { signal?: AbortSignal } = {}): Promise<OcrServerResult> {
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(new OcrError('aborted'));
    if (this.stopped || !this.isAvailable()) return Promise.reject(new OcrError('unavailable', this.retryAfterSeconds()));
    if (this.isFull()) return Promise.reject(new OcrError('busy', this.retryAfterSeconds()));

    return new Promise<OcrServerResult>((resolve, reject) => {
      const job: Job = { image, acceptedAt: this.opts.now(), signal, resolve, reject, onAbort: null };
      if (signal) {
        job.onAbort = () => {
          const index = this.queue.indexOf(job);
          if (index >= 0) {
            this.queue.splice(index, 1);
            reject(new OcrError('aborted'));
          }
        };
        signal.addEventListener('abort', job.onAbort, { once: true });
      }
      this.queue.push(job);
      this.pump();
    });
  }

  /** Stops the engine and refuses queued jobs (process shutdown, tests). */
  async shutdown(): Promise<void> {
    this.stopped = true;
    this.clearIdleTimer();
    for (const job of this.queue.splice(0)) this.settle(job, new OcrError('unavailable'));
    await this.discardEngine('shutdown');
  }

  private isFull(): boolean {
    return this.running && this.queue.length >= this.opts.maxQueue;
  }

  private isAvailable(): boolean {
    if (this.initFailedAt !== null && this.opts.now() - this.initFailedAt < this.opts.initFailureCooldownMs) return false;
    return this.opts.isModelAvailable ? this.opts.isModelAvailable() : true;
  }

  private settle(job: Job, outcome: OcrServerResult | OcrError): void {
    if (job.onAbort) job.signal?.removeEventListener('abort', job.onAbort);
    if (outcome instanceof OcrError) job.reject(outcome);
    else job.resolve(outcome);
  }

  private pump(): void {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) {
      this.scheduleIdleStop();
      return;
    }
    this.running = true;
    this.clearIdleTimer();
    void this.runJob(job)
      .then(
        (result) => this.settle(job, result),
        (error: unknown) => this.settle(job, error instanceof OcrError ? error : new OcrError('failed')),
      )
      .finally(() => {
        this.running = false;
        this.pump();
      });
  }

  private async runJob(job: Job): Promise<OcrServerResult> {
    if (job.signal?.aborted) throw new OcrError('aborted');
    const startedAt = this.opts.now();
    const remaining = this.opts.deadlineMs - (startedAt - job.acceptedAt);
    if (remaining < this.opts.minStartBudgetMs) throw new OcrError('busy', this.retryAfterSeconds());

    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new OcrError('timeout', this.retryAfterSeconds())), remaining);
    });
    const work = this.process(job.image, startedAt);
    work.catch(() => undefined);
    try {
      const result = await Promise.race([work, deadline]);
      const duration = this.opts.now() - startedAt;
      this.averageJobMs = Math.round(this.averageJobMs * 0.7 + duration * 0.3);
      this.opts.logger.info('ocr_server_done', { durationMs: duration, blocks: result.blocks.length, confidence: result.confidence });
      return result;
    } catch (error) {
      if (error instanceof OcrError && error.kind === 'timeout') {
        this.opts.logger.warn('ocr_server_timeout', { elapsedMs: this.opts.now() - job.acceptedAt });
        this.engineGeneration += 1;
        this.enginePromise = null;
        await this.discardEngine('timeout');
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async process(image: Uint8Array, startedAt: number): Promise<OcrServerResult> {
    const engine = await this.getEngine();
    const first = await this.pass(engine, image, '3');
    let best = first;
    if (first.confidence < this.opts.lowConfidence && this.opts.now() - startedAt < this.opts.secondPassMaxElapsedMs) {
      const second = await this.pass(engine, image, '6');
      best = pickBetterPass(first, second);
    }
    return { blocks: pageToTextBlocks(best.page), confidence: best.confidence, engine: 'tesseract-best' };
  }

  private async pass(engine: OcrEngine, image: Uint8Array, psm: OcrPsm): Promise<Pass> {
    try {
      const page = await engine.recognize(image, psm);
      return { page, confidence: pageConfidence(page), chars: pageCharCount(page) };
    } catch (error) {
      if (isImageDecodeError(error)) throw new OcrError('invalid_image');
      this.opts.logger.warn('ocr_server_recognize_failed', { psm, error: error instanceof Error ? error.message : String(error) });
      if (this.engine === engine) await this.discardEngine('error');
      throw new OcrError('failed');
    }
  }

  private getEngine(): Promise<OcrEngine> {
    const current = this.engine;
    if (current && current.isAlive?.() !== false) return Promise.resolve(current);
    if (current) void this.discardEngine('dead');
    if (!this.enginePromise) {
      const startedAt = this.opts.now();
      const generation = this.engineGeneration;
      const promise: Promise<OcrEngine> = this.opts
        .engineFactory()
        .then(
          (engine) => {
            if (generation !== this.engineGeneration || this.stopped) {
              void engine.terminate().catch(() => undefined);
              throw new OcrError('timeout', this.retryAfterSeconds());
            }
            this.engine = engine;
            this.initFailedAt = null;
            this.opts.logger.info('ocr_server_engine_ready', { durationMs: this.opts.now() - startedAt });
            return engine;
          },
          (error: unknown) => {
            if (generation === this.engineGeneration) this.initFailedAt = this.opts.now();
            this.opts.logger.error('ocr_server_engine_failed', { error: error instanceof Error ? error.message : String(error) });
            throw new OcrError('unavailable', this.retryAfterSeconds());
          },
        )
        .finally(() => {
          if (this.enginePromise === promise) this.enginePromise = null;
        });
      this.enginePromise = promise;
    }
    return this.enginePromise;
  }

  private scheduleIdleStop(): void {
    if (this.idleTimer || !this.engine) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.running && this.queue.length === 0) void this.discardEngine('idle');
    }, this.opts.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private async discardEngine(reason: string): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    if (!engine) return;
    try {
      await engine.terminate();
      this.opts.logger.info('ocr_server_engine_stopped', { reason });
    } catch (error) {
      this.opts.logger.warn('ocr_server_engine_stop_failed', { reason, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
