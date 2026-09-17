// « Tester la lecture sur cet appareil »: runs each step of the document pipeline on synthetic content and
// reports the outcome to /api/diagnostics, so problems that only happen on the family iPad can be understood.
import { normalizeForMatch, type DiagnosticValue } from '@aide/shared';
import { db } from '../db/localDb';
import { BrowserOcrEngine, withTimeout } from '../ocr/BrowserOCR';
import { prepareFallbackPage, preparePage } from '../ocr/preprocess/client';
import { recognizeOnServer } from '../ocr/ServerOCR';
import { deviceCapabilities, describeError, flushDiagnostics, reportProblem } from '../platform/diagnostics';
import { openPdf } from './PDFReader';

export type SelfTestStepId = 'capabilities' | 'storage' | 'ocr_engine' | 'photo' | 'pdf' | 'server_ocr';
export type SelfTestStatus = 'pending' | 'running' | 'ok' | 'warning' | 'error' | 'skipped';

export interface SelfTestStep {
  id: SelfTestStepId;
  status: SelfTestStatus;
  durationMs: number | null;
  /** Technical detail shown to the parent (error message, sizes, flags). */
  detail: string | null;
}

export const SELF_TEST_STEPS: readonly SelfTestStepId[] = ['capabilities', 'storage', 'ocr_engine', 'photo', 'pdf', 'server_ocr'];
const STEP_TIMEOUT_MS = 240_000;
const EXPECTED_WORDS = 'bonjour le monde';

/** Minimal one-page PDF with a text layer (standard Helvetica font). pdf.js rebuilds the missing cross-reference table. */
const TINY_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 360 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 46>>stream
BT /F1 28 Tf 24 60 Td (Bonjour le monde) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;

type StepOutcome = { status: 'ok' | 'warning' | 'error' | 'skipped'; detail: string };

export interface SelfTestDeps {
  capabilities(): Record<string, DiagnosticValue>;
  storage(): Promise<StepOutcome>;
  ocrEngine(): Promise<StepOutcome & { sampleImage?: Blob }>;
  photo(): Promise<StepOutcome>;
  pdf(): Promise<StepOutcome>;
  serverOcr(sampleImage: Blob | null): Promise<StepOutcome>;
  report(kind: 'self_test', message: string, stage: string, context: Record<string, DiagnosticValue>): void;
  flush(): Promise<void>;
  now(): number;
}

function canvas(width: number, height: number): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('canvas_2d_unavailable');
  return { el, ctx };
}

function toBlob(el: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => el.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas_encode_failed'))), type, quality));
}

function release(el: HTMLCanvasElement): void {
  el.width = 0;
  el.height = 0;
}

async function textImage(): Promise<Blob> {
  const { el, ctx } = canvas(1400, 360);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, el.width, el.height);
  ctx.fillStyle = '#111111';
  ctx.font = '96px Georgia, "Times New Roman", serif';
  ctx.fillText('Bonjour le monde', 80, 220);
  const blob = await toBlob(el, 'image/png');
  release(el);
  return blob;
}

/** 12 MP phone-like photo: several lines of text on an unevenly lit page. */
async function largePhoto(): Promise<Blob> {
  const { el, ctx } = canvas(3024, 4032);
  const light = ctx.createLinearGradient(0, 0, el.width, el.height);
  light.addColorStop(0, '#f4efe4');
  light.addColorStop(1, '#b9b1a3');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, el.width, el.height);
  ctx.fillStyle = '#1b1b1b';
  ctx.font = '120px Georgia, serif';
  for (let i = 0; i < 18; i++) ctx.fillText('La lave coulait lentement sur la pente.', 220, 420 + i * 190);
  const blob = await toBlob(el, 'image/jpeg', 0.9);
  release(el);
  return blob;
}

export function defaultSelfTestDeps(): SelfTestDeps {
  return {
    capabilities: deviceCapabilities,
    async storage() {
      const blob = new Blob([new Uint8Array(256_000)], { type: 'application/octet-stream' });
      await db.kv.put({ key: 'selfTestBlob', value: blob });
      const back = (await db.kv.get('selfTestBlob'))?.value;
      await db.kv.delete('selfTestBlob');
      const size = back instanceof Blob ? back.size : -1;
      return size === blob.size ? { status: 'ok', detail: 'IndexedDB + Blob' } : { status: 'error', detail: `blob_roundtrip size=${size}` };
    },
    async ocrEngine() {
      const engine = new BrowserOcrEngine();
      try {
        const image = await textImage();
        const result = await engine.recognize(image);
        const text = normalizeForMatch(result.lines.map((l) => l.text).join(' '));
        return text.includes(EXPECTED_WORDS)
          ? { status: 'ok', detail: `confiance ${Math.round(result.confidence)}`, sampleImage: image }
          : { status: 'warning', detail: `texte lu : « ${text.slice(0, 40)} »`, sampleImage: image };
      } finally {
        await engine.terminate();
      }
    },
    async photo() {
      const photo = await largePhoto();
      try {
        const prepared = await preparePage(photo, { denoise: true, crop: true, deskew: true });
        return { status: 'ok', detail: `${prepared.image.width}×${prepared.image.height} px` };
      } catch (error) {
        const fallback = await prepareFallbackPage(photo, {});
        return { status: 'warning', detail: `préparation réduite utilisée (${fallback.image.width}×${fallback.image.height} px) — ${describeError(error)}` };
      }
    },
    async pdf() {
      const handle = await openPdf(new TextEncoder().encode(TINY_PDF));
      try {
        const lines = await handle.getPageLines(0);
        const text = normalizeForMatch(lines.map((l) => l.text).join(' '));
        const image = await handle.renderPage(0, 1000);
        const detail = `${handle.numPages} page, rendu ${image.width}×${image.height} px`;
        return text.includes(EXPECTED_WORDS) ? { status: 'ok', detail } : { status: 'warning', detail: `${detail}, texte « ${text.slice(0, 40)} »` };
      } finally {
        await handle.destroy();
      }
    },
    async serverOcr(sample) {
      if (!sample) return { status: 'skipped', detail: 'pas d’image de test' };
      const outcome = await recognizeOnServer(sample);
      if (outcome.status === 'ok') {
        const text = normalizeForMatch(outcome.blocks.map((b) => b.text).join(' '));
        return text.includes(EXPECTED_WORDS) ? { status: 'ok', detail: `confiance ${Math.round(outcome.confidence)}` } : { status: 'warning', detail: 'texte incomplet' };
      }
      return { status: outcome.status === 'busy' ? 'warning' : 'error', detail: outcome.status === 'busy' ? 'serveur occupé' : outcome.reason };
    },
    report: (kind, message, stage, context) => reportProblem(kind, message, stage, context),
    flush: flushDiagnostics,
    now: () => Date.now(),
  };
}

/** Runs every step in order; `onUpdate` receives the full list after each change. Never throws. */
export async function runSelfTest(onUpdate: (steps: SelfTestStep[]) => void, deps: SelfTestDeps = defaultSelfTestDeps()): Promise<SelfTestStep[]> {
  const steps: SelfTestStep[] = SELF_TEST_STEPS.map((id) => ({ id, status: 'pending', durationMs: null, detail: null }));
  const emit = (): void => onUpdate(steps.map((s) => ({ ...s })));
  let sampleImage: Blob | null = null;

  const run = async (id: SelfTestStepId, fn: () => Promise<StepOutcome>): Promise<void> => {
    const step = steps.find((s) => s.id === id)!;
    step.status = 'running';
    emit();
    const started = deps.now();
    try {
      const outcome = await withTimeout(fn(), STEP_TIMEOUT_MS, id);
      step.status = outcome.status;
      step.detail = outcome.detail;
    } catch (error) {
      step.status = 'error';
      step.detail = describeError(error);
    }
    step.durationMs = deps.now() - started;
    if (step.status === 'error' || step.status === 'warning') {
      deps.report('self_test', step.detail ?? step.status, id, { status: step.status, durationMs: step.durationMs });
    }
    emit();
  };

  await run('capabilities', async () => {
    const caps = deps.capabilities();
    const missing = (['wasm', 'worker'] as const).filter((k) => caps[k] !== true);
    const detail = Object.entries(caps).map(([k, v]) => `${k}=${String(v)}`).join(' · ');
    return missing.length > 0 ? { status: 'error', detail } : { status: 'ok', detail };
  });
  await run('storage', () => deps.storage());
  await run('ocr_engine', async () => {
    const outcome = await deps.ocrEngine();
    sampleImage = outcome.sampleImage ?? null;
    return outcome;
  });
  await run('photo', () => deps.photo());
  await run('pdf', () => deps.pdf());
  await run('server_ocr', () => deps.serverOcr(sampleImage));

  const summary: Record<string, DiagnosticValue> = {};
  for (const s of steps) {
    summary[s.id] = s.status;
    summary[`${s.id}Ms`] = s.durationMs;
  }
  const errors = steps.filter((s) => s.status === 'error').length;
  deps.report('self_test', `summary errors=${errors}`, 'summary', summary);
  await deps.flush().catch(() => undefined);
  return steps;
}
