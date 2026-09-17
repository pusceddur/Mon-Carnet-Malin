import { afterEach, describe, expect, it } from 'vitest';
import type { OcrPage } from '../../src/ocr/layout';
import { OcrError, pickBetterPass, ServerOCR, type OcrEngine, type OcrPsm, type ServerOcrOptions } from '../../src/ocr/ServerOCR';

const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function page(text: string, confidence: number): OcrPage {
  const words = text.split(' ').map((w) => ({ text: w, confidence }));
  return { blocks: [{ paragraphs: [[{ text, top: 10, left: 10, width: 400, height: 20, rowHeight: 20, words }]] }] };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FakeEngine implements OcrEngine {
  readonly calls: OcrPsm[] = [];
  terminated = false;
  alive = true;
  active = 0;
  peak = 0;

  constructor(private readonly behavior: (psm: OcrPsm) => Promise<OcrPage>) {}

  async recognize(_image: Uint8Array, psm: OcrPsm): Promise<OcrPage> {
    this.calls.push(psm);
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    try {
      return await this.behavior(psm);
    } finally {
      this.active -= 1;
    }
  }

  isAlive(): boolean {
    return this.alive;
  }

  async terminate(): Promise<void> {
    this.terminated = true;
  }
}

const instances: ServerOCR[] = [];

function makeOcr(behavior: (psm: OcrPsm) => Promise<OcrPage>, options: Partial<ServerOcrOptions> = {}) {
  const engines: FakeEngine[] = [];
  const ocr = new ServerOCR({
    engineFactory: async () => {
      const engine = new FakeEngine(behavior);
      engines.push(engine);
      return engine;
    },
    ...options,
  });
  instances.push(ocr);
  return { ocr, engines };
}

async function rejection(promise: Promise<unknown>): Promise<OcrError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OcrError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((o) => o.shutdown()));
});

describe('ServerOCR engine lifecycle', () => {
  it('creates the engine lazily on the first job and reuses it', async () => {
    const { ocr, engines } = makeOcr(async () => page('Bonjour tout le monde', 95));
    expect(engines).toHaveLength(0);
    expect(ocr.status()).toMatchObject({ available: true, busy: false, engineLoaded: false });

    const result = await ocr.recognize(IMAGE);
    await ocr.recognize(IMAGE);
    expect(engines).toHaveLength(1);
    expect(result.engine).toBe('tesseract-best');
    expect(result.confidence).toBe(95);
    expect(result.blocks.map((b) => b.text).join(' ')).toBe('Bonjour tout le monde');
    expect(ocr.status().engineLoaded).toBe(true);
  });

  it('stops the engine after the idle delay and starts a new one later', async () => {
    const { ocr, engines } = makeOcr(async () => page('Texte', 90), { idleTimeoutMs: 30 });
    await ocr.recognize(IMAGE);
    expect(engines[0]?.terminated).toBe(false);
    await sleep(80);
    expect(engines[0]?.terminated).toBe(true);
    expect(ocr.status().engineLoaded).toBe(false);
    await ocr.recognize(IMAGE);
    expect(engines).toHaveLength(2);
  });

  it('reports unavailable while the engine cannot start, then retries after the cooldown', async () => {
    let clock = 1_000_000;
    let failures = 1;
    const ocr = new ServerOCR({
      now: () => clock,
      initFailureCooldownMs: 60_000,
      engineFactory: async () => {
        if (failures > 0) {
          failures -= 1;
          throw new Error('model missing');
        }
        return new FakeEngine(async () => page('Retour', 90));
      },
    });
    instances.push(ocr);
    expect((await rejection(ocr.recognize(IMAGE))).kind).toBe('unavailable');
    expect(ocr.status().available).toBe(false);
    expect((await rejection(ocr.recognize(IMAGE))).kind).toBe('unavailable');
    clock += 60_001;
    expect(ocr.status().available).toBe(true);
    await expect(ocr.recognize(IMAGE)).resolves.toMatchObject({ confidence: 90 });
  });

  it('refuses jobs without calling the factory when the model files are missing', async () => {
    const { ocr, engines } = makeOcr(async () => page('x', 90), { isModelAvailable: () => false });
    expect(ocr.status().available).toBe(false);
    expect((await rejection(ocr.recognize(IMAGE))).kind).toBe('unavailable');
    expect(engines).toHaveLength(0);
  });

  it('replaces a crashed engine', async () => {
    const { ocr, engines } = makeOcr(async () => page('Texte', 90));
    await ocr.recognize(IMAGE);
    const first = engines[0];
    if (first) first.alive = false;
    await ocr.recognize(IMAGE);
    expect(engines).toHaveLength(2);
    expect(first?.terminated).toBe(true);
  });
});

describe('ServerOCR page segmentation passes', () => {
  it('runs only PSM 3 when the confidence is good', async () => {
    const { ocr, engines } = makeOcr(async () => page('Une phrase bien lue', 88));
    await ocr.recognize(IMAGE);
    expect(engines[0]?.calls).toEqual(['3']);
  });

  it('runs PSM 6 when PSM 3 is not confident and keeps the better pass', async () => {
    const { ocr, engines } = makeOcr(async (psm) => (psm === '3' ? page('Une pbrase mal lue', 50) : page('Une phrase bien lue', 85)));
    const result = await ocr.recognize(IMAGE);
    expect(engines[0]?.calls).toEqual(['3', '6']);
    expect(result.confidence).toBe(85);
    expect(result.blocks.map((b) => b.text).join(' ')).toBe('Une phrase bien lue');
  });

  it('keeps PSM 3 when PSM 6 is not better', async () => {
    const { ocr } = makeOcr(async (psm) => (psm === '3' ? page('Une phrase', 60) : page('Une', 61)));
    expect((await ocr.recognize(IMAGE)).confidence).toBe(60);
  });

  it('skips PSM 6 when PSM 3 took 40 seconds or more', async () => {
    let clock = 0;
    const { ocr, engines } = makeOcr(
      async () => {
        clock += 40_000;
        return page('Lent et peu sûr', 40);
      },
      { now: () => clock },
    );
    const result = await ocr.recognize(IMAGE);
    expect(engines[0]?.calls).toEqual(['3']);
    expect(result.confidence).toBe(40);
  });

  it('pickBetterPass compares confidence and amount of text', () => {
    const a = { confidence: 50, chars: 100 };
    expect(pickBetterPass(a, { confidence: 80, chars: 90 })).toEqual({ confidence: 80, chars: 90 });
    expect(pickBetterPass(a, { confidence: 80, chars: 40 })).toBe(a);
    expect(pickBetterPass(a, { confidence: 51, chars: 100 })).toBe(a);
    expect(pickBetterPass({ confidence: 0, chars: 0 }, { confidence: 30, chars: 5 })).toEqual({ confidence: 30, chars: 5 });
    expect(pickBetterPass(a, { confidence: 99, chars: 0 })).toBe(a);
  });
});

describe('ServerOCR queue', () => {
  it('runs one job at a time, queues 3 and refuses the next with busy + Retry-After', async () => {
    const gates: Deferred<OcrPage>[] = [];
    const { ocr, engines } = makeOcr(() => {
      const gate = deferred<OcrPage>();
      gates.push(gate);
      return gate.promise;
    });

    const jobs = [0, 1, 2, 3].map(() => ocr.recognize(IMAGE));
    await sleep(10);
    expect(ocr.status()).toMatchObject({ running: true, queued: 3, busy: true });

    const refused = await rejection(ocr.recognize(IMAGE));
    expect(refused.kind).toBe('busy');
    expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(5);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(120);

    for (let i = 0; i < 4; i += 1) {
      await sleep(5);
      gates[i]?.resolve(page(`Page ${i + 1}`, 90));
    }
    const results = await Promise.all(jobs);
    expect(results.map((r) => r.blocks[0]?.text)).toEqual(['Page 1', 'Page 2', 'Page 3', 'Page 4']);
    expect(engines[0]?.peak).toBe(1);
    expect(ocr.status()).toMatchObject({ running: false, queued: 0, busy: false });
  });

  it('removes an aborted job from the queue', async () => {
    const gate = deferred<OcrPage>();
    const { ocr, engines } = makeOcr(() => gate.promise);
    const running = ocr.recognize(IMAGE);
    const controller = new AbortController();
    const queued = ocr.recognize(IMAGE, { signal: controller.signal });
    await sleep(5);
    expect(ocr.status().queued).toBe(1);
    controller.abort();
    expect((await rejection(queued)).kind).toBe('aborted');
    expect(ocr.status().queued).toBe(0);
    gate.resolve(page('Fini', 90));
    await expect(running).resolves.toMatchObject({ confidence: 90 });
    expect(engines[0]?.calls).toEqual(['3']);
  });

  it('refuses a queued job whose remaining time is too short to start', async () => {
    const { ocr } = makeOcr(async () => {
      await sleep(80);
      return page('Long', 90);
    }, { deadlineMs: 120, minStartBudgetMs: 60 });
    const first = ocr.recognize(IMAGE);
    const second = ocr.recognize(IMAGE);
    await expect(first).resolves.toMatchObject({ confidence: 90 });
    expect((await rejection(second)).kind).toBe('busy');
  });

  it('kills the engine when the deadline is exceeded and recovers for the next job', async () => {
    let hang = true;
    const { ocr, engines } = makeOcr(
      async () => {
        if (hang) return new Promise<OcrPage>(() => undefined);
        return page('Reprise', 90);
      },
      { deadlineMs: 60, minStartBudgetMs: 10 },
    );
    const error = await rejection(ocr.recognize(IMAGE));
    expect(error.kind).toBe('timeout');
    expect(engines[0]?.terminated).toBe(true);
    hang = false;
    await expect(ocr.recognize(IMAGE)).resolves.toMatchObject({ confidence: 90 });
    expect(engines).toHaveLength(2);
  });

  it('abandons an engine whose start exceeded the deadline', async () => {
    const started: FakeEngine[] = [];
    let slowStart = true;
    const ocr = new ServerOCR({
      deadlineMs: 50,
      minStartBudgetMs: 10,
      engineFactory: async () => {
        const engine = new FakeEngine(async () => page('Ok', 90));
        started.push(engine);
        if (slowStart) {
          slowStart = false;
          await sleep(120);
        }
        return engine;
      },
    });
    instances.push(ocr);
    expect((await rejection(ocr.recognize(IMAGE))).kind).toBe('timeout');
    await sleep(100);
    expect(started[0]?.terminated).toBe(true);
    expect(ocr.status().engineLoaded).toBe(false);
    await expect(ocr.recognize(IMAGE)).resolves.toMatchObject({ confidence: 90 });
  });
});

describe('ServerOCR errors', () => {
  it('maps unreadable images to invalid_image and keeps the engine', async () => {
    const { ocr, engines } = makeOcr(async () => {
      throw 'Error: Error attempting to read image.';
    });
    expect((await rejection(ocr.recognize(IMAGE))).kind).toBe('invalid_image');
    expect(engines[0]?.terminated).toBe(false);
  });

  it('maps other engine errors to failed and discards the engine', async () => {
    const { ocr, engines } = makeOcr(async () => {
      throw new Error('RuntimeError: memory access out of bounds');
    });
    expect((await rejection(ocr.recognize(IMAGE))).kind).toBe('failed');
    expect(engines[0]?.terminated).toBe(true);
  });

  it('refuses queued jobs on shutdown', async () => {
    const gate = deferred<OcrPage>();
    const { ocr } = makeOcr(() => gate.promise);
    const running = ocr.recognize(IMAGE);
    const queued = ocr.recognize(IMAGE);
    await sleep(5);
    await ocr.shutdown();
    expect((await rejection(queued)).kind).toBe('unavailable');
    gate.resolve(page('x', 90));
    await running.catch(() => undefined);
    expect((await rejection(ocr.recognize(IMAGE))).kind).toBe('unavailable');
  });
});
