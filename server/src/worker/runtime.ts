// Per-app runtime of the external worker integration: presence cache, same-process job notifications, shutdown signal.
// Several server processes may run side by side: the database stays the source of truth, memory is only an optimization.
import { EventEmitter } from 'node:events';
import type { Knex } from 'knex';
import { listWorkerStates, type WorkerState } from '../db/repositories/workerJobs';
import type { Logger } from '../logger';
import type { AppDeps } from '../types';
import { WORKER_PROTOCOL } from './protocol';

/** The presence cache is read from the database at most this often (per process). */
export const PRESENCE_CACHE_MS = 5_000;

export interface PresenceSnapshot {
  /** A worker was seen recently and is not paused by a usage limit. */
  available: boolean;
  /** A worker was seen recently. */
  connected: boolean;
  lastSeenAt: number | null;
  /** Every recently seen worker is paused by a usage limit. */
  limited: boolean;
  limitResetsAt: number | null;
}

/** Availability computed from worker_state rows at time `now` (§17.4: seen within 90 s and not limited). */
export function presenceOf(states: readonly WorkerState[], now: number): PresenceSnapshot {
  const recent = states.filter((s) => s.lastSeenAt >= now - WORKER_PROTOCOL.presenceWindowMs);
  const usable = recent.filter((s) => !(s.limitedUntil !== null && s.limitedUntil > now));
  const limitedNow = states.filter((s) => s.limitedUntil !== null && s.limitedUntil > now);
  const lastSeenAt = states.reduce<number | null>((max, s) => (max === null || s.lastSeenAt > max ? s.lastSeenAt : max), null);
  const limited = usable.length === 0 && limitedNow.length > 0;
  return {
    available: usable.length > 0,
    connected: recent.length > 0,
    lastSeenAt,
    limited,
    limitResetsAt: limited ? Math.min(...limitedNow.map((s) => s.limitedUntil ?? 0)) : null,
  };
}

export class WorkerPresence {
  private states: readonly WorkerState[] | null = null;
  private loadedAt = -Infinity;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly db: Knex,
    private readonly now: () => number,
    private readonly logger: Logger,
    private readonly cacheMs = PRESENCE_CACHE_MS,
  ) {}

  /** Reloads worker_state when the cache is older than `cacheMs` (or always with `force`). Never throws. */
  refresh(force = false): Promise<void> {
    if (!force && this.states !== null && performance.now() - this.loadedAt < this.cacheMs) return Promise.resolve();
    if (this.inflight) return this.inflight;
    const run = listWorkerStates(this.db)
      .then((states) => {
        this.states = states;
        this.loadedAt = performance.now();
      })
      .catch((err: unknown) => {
        this.logger.warn('worker_presence_refresh_failed', { error: err });
      })
      .finally(() => {
        this.inflight = null;
      });
    this.inflight = run;
    return run;
  }

  /** Cached snapshot (refreshed in the background when stale; unknown = not available). */
  snapshot(): PresenceSnapshot {
    void this.refresh();
    return presenceOf(this.states ?? [], this.now());
  }

  isAvailable(): boolean {
    return this.snapshot().available;
  }

  /** Drops the cache (a worker route of this process just wrote worker_state). */
  invalidate(): void {
    this.loadedAt = -Infinity;
  }
}

export class WorkerRuntime {
  readonly presence: WorkerPresence;
  private readonly events = new EventEmitter();
  private readonly closer = new AbortController();

  constructor(db: Knex, now: () => number, logger: Logger) {
    this.presence = new WorkerPresence(db, now, logger);
    this.events.setMaxListeners(0);
  }

  /** A job changed state in this process (result received, lease expired…). */
  notifyJob(jobId: string): void {
    this.events.emit(jobId);
  }

  onJob(jobId: string, listener: () => void): () => void {
    this.events.on(jobId, listener);
    return () => this.events.off(jobId, listener);
  }

  /** Aborted on graceful shutdown: long polls answer at once and pending waits give up. */
  get closeSignal(): AbortSignal {
    return this.closer.signal;
  }

  get closing(): boolean {
    return this.closer.signal.aborted;
  }

  close(): void {
    if (!this.closer.signal.aborted) this.closer.abort();
  }
}

const runtimes = new WeakMap<AppDeps, WorkerRuntime>();

export function getWorkerRuntime(deps: AppDeps): WorkerRuntime {
  let runtime = runtimes.get(deps);
  if (!runtime) {
    runtime = new WorkerRuntime(deps.db, () => deps.now(), deps.logger.child({ component: 'worker' }));
    runtimes.set(deps, runtime);
  }
  return runtime;
}

/** The runtime of `deps` if it exists (never creates it: graceful shutdown). */
export function peekWorkerRuntime(deps: AppDeps): WorkerRuntime | null {
  return runtimes.get(deps) ?? null;
}
