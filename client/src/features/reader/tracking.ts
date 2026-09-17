// Reading progress and reading session bookkeeping (saved through saveEntity → sync).
import { newId, type Id, type ReadingProgress, type ReadingSession } from '@aide/shared';

export interface ReadingPosition { pageIndex: number; blockIndex: number; sentenceIndex: number }

/** Debounced ReadingProgress writer; identical positions are not written twice. */
export class ProgressSaver {
  private pending: ReadingPosition | null = null;
  private last: ReadingPosition | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly childId: Id,
    private readonly documentId: Id,
    private readonly save: (progress: ReadingProgress) => Promise<void>,
    private readonly delayMs = 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Known saved position (resume) so that re-opening at the same place writes nothing. */
  prime(position: ReadingPosition | null): void {
    this.last = position;
  }

  update(position: ReadingPosition): void {
    this.pending = position;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const position = this.pending;
    this.pending = null;
    if (!position) return;
    const last = this.last;
    if (last && last.pageIndex === position.pageIndex && last.blockIndex === position.blockIndex && last.sentenceIndex === position.sentenceIndex) return;
    this.last = position;
    try {
      await this.save({ childId: this.childId, documentId: this.documentId, ...position, updatedAt: this.now() });
    } catch {
      this.last = last;
    }
  }
}

/** One ReadingSession per opening of the reader. Saved only once something happened. */
export class ReadingSessionTracker {
  private readonly session: ReadingSession;
  private dirty = false;
  private ttsStartedAt: number | null = null;

  constructor(
    childId: Id,
    documentId: Id,
    private readonly save: (session: ReadingSession) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {
    const startedAt = now();
    this.session = {
      id: newId(), childId, documentId, startedAt, endedAt: startedAt, pagesViewed: [], ttsSeconds: 0, wordsLookedUp: 0, aiRequests: 0,
      updatedAt: startedAt,
    };
  }

  markPage(pageIndex: number): void {
    if (this.session.pagesViewed.includes(pageIndex)) return;
    this.session.pagesViewed = [...this.session.pagesViewed, pageIndex].sort((a, b) => a - b);
    this.dirty = true;
  }

  ttsStarted(): void {
    if (this.ttsStartedAt === null) this.ttsStartedAt = this.now();
  }

  ttsStopped(): void {
    if (this.ttsStartedAt === null) return;
    const seconds = Math.max(0, Math.round((this.now() - this.ttsStartedAt) / 1000));
    this.ttsStartedAt = null;
    if (seconds > 0) {
      this.session.ttsSeconds += seconds;
      this.dirty = true;
    }
  }

  countLookup(): void {
    this.session.wordsLookedUp += 1;
    this.dirty = true;
  }

  countAiRequest(): void {
    this.session.aiRequests += 1;
    this.dirty = true;
  }

  snapshot(): ReadingSession {
    return { ...this.session, pagesViewed: [...this.session.pagesViewed] };
  }

  async persist(): Promise<void> {
    if (this.ttsStartedAt !== null) {
      // Count listening time up to now without stopping the measure.
      this.ttsStopped();
      this.ttsStarted();
    }
    if (!this.dirty) return;
    const now = this.now();
    this.session.endedAt = now;
    this.session.updatedAt = now;
    this.dirty = false;
    try {
      await this.save(this.snapshot());
    } catch {
      this.dirty = true;
    }
  }
}
