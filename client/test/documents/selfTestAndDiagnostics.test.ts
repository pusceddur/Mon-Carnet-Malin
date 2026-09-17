import type { ClientDiagnosticReport } from '@aide/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSelfTest, type SelfTestDeps, type SelfTestStep } from '../../src/documents/selfTest';
import { withTimeout } from '../../src/ocr/BrowserOCR';
import { describeError, flushDiagnostics, reportProblem, setDiagnosticsSender } from '../../src/platform/diagnostics';

function collectReports(): ClientDiagnosticReport[] {
  const reports: ClientDiagnosticReport[] = [];
  setDiagnosticsSender(async (batch) => {
    reports.push(...batch);
    return true;
  });
  return reports;
}

afterEach(() => setDiagnosticsSender(null));

describe('diagnostics reporter', () => {
  it('describes errors, worker Events and plain values', () => {
    expect(describeError(new TypeError('Load failed'))).toBe('TypeError: Load failed');
    expect(describeError(new Event('error'))).toBe('Event: type=error');
    expect(describeError('boom')).toBe('boom');
    expect(describeError({ code: 7 })).toBe('{"code":7}');
  });

  it('sends each problem once per session, with device capabilities and clipped values', async () => {
    const reports = collectReports();
    reportProblem('ocr_engine', new Error('worker failed'), 'create_worker', { detail: 'x'.repeat(500) });
    reportProblem('ocr_engine', new Error('worker failed'), 'create_worker');
    reportProblem('preprocess', new Error('memory'), 'preprocess', { pageIndex: 3 });
    await flushDiagnostics();
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({ kind: 'ocr_engine', stage: 'create_worker', message: 'Error: worker failed' });
    expect(reports[0]?.context).toHaveProperty('wasm');
    expect(String(reports[0]?.context.detail).length).toBeLessThanOrEqual(200);
    expect(reports[1]?.context).toMatchObject({ pageIndex: 3 });
  });

  it('never throws, even when sending fails', async () => {
    setDiagnosticsSender(async () => {
      throw new Error('offline');
    });
    expect(() => reportProblem('other', new Error('x'))).not.toThrow();
    await expect(flushDiagnostics()).resolves.toBeUndefined();
  });
});

describe('withTimeout', () => {
  it('rejects a promise that never settles', async () => {
    vi.useFakeTimers();
    try {
      const pending = withTimeout(new Promise(() => undefined), 1000, 'create_worker');
      const assertion = expect(pending).rejects.toThrow('create_worker_timeout');
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('device self-test', () => {
  function deps(overrides: Partial<SelfTestDeps> = {}): SelfTestDeps & { reports: [string, string][] } {
    const reports: [string, string][] = [];
    let clock = 0;
    return {
      reports,
      capabilities: () => ({ wasm: true, worker: true, ipad: true }),
      storage: async () => ({ status: 'ok', detail: 'IndexedDB + Blob' }),
      ocrEngine: async () => ({ status: 'ok', detail: 'confiance 91', sampleImage: new Blob(['png']) }),
      photo: async () => ({ status: 'ok', detail: '2480×3307 px' }),
      pdf: async () => ({ status: 'ok', detail: '1 page' }),
      serverOcr: async (sample) => (sample ? { status: 'ok', detail: 'confiance 95' } : { status: 'skipped', detail: 'none' }),
      report: (_kind, message, stage) => reports.push([stage, message]),
      flush: async () => undefined,
      now: () => (clock += 250),
      ...overrides,
    };
  }

  it('runs every step in order and reports only the summary when all is well', async () => {
    const d = deps();
    const updates: SelfTestStep[][] = [];
    const steps = await runSelfTest((s) => updates.push(s), d);
    expect(steps.map((s) => s.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(updates.length).toBeGreaterThanOrEqual(12);
    expect(d.reports).toEqual([['summary', 'summary errors=0']]);
  });

  it('keeps going after a failing step, marks it as a problem and reports it', async () => {
    const d = deps({
      ocrEngine: async () => {
        throw new Error('create_worker_timeout');
      },
      photo: async () => ({ status: 'warning', detail: 'préparation réduite utilisée' }),
    });
    const steps = await runSelfTest(() => undefined, d);
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.ocr_engine).toMatchObject({ status: 'error', detail: 'Error: create_worker_timeout' });
    expect(byId.photo?.status).toBe('warning');
    // No sample image from the failed engine step: the server step is skipped, not failed.
    expect(byId.server_ocr?.status).toBe('skipped');
    expect(d.reports.map(([stage]) => stage)).toEqual(['ocr_engine', 'photo', 'summary']);
    expect(d.reports.at(-1)?.[1]).toBe('summary errors=1');
  });
});
