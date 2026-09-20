// Technical problem reports sent to the server (/api/diagnostics) so that device-only failures (iPad Safari) can be understood.
// Never includes document text: only error names/messages, the processing stage and capability flags.
import { DIAGNOSTIC_LIMITS, type ClientDiagnosticKind, type ClientDiagnosticReport, type DiagnosticValue } from '@aide/shared';
import { apiUrl, authHeaders, credentialsMode } from '../api/endpoint';
import { isIPad, isStandalonePwa } from './support';

export type DiagnosticContext = Record<string, DiagnosticValue | undefined>;

const MAX_REPORTS_PER_SESSION = 60;
const FLUSH_DELAY_MS = 2_000;

let queue: ClientDiagnosticReport[] = [];
let sentThisSession = 0;
const seen = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

type Sender = (reports: ClientDiagnosticReport[]) => Promise<boolean>;

async function defaultSender(reports: ClientDiagnosticReport[]): Promise<boolean> {
  if (typeof fetch !== 'function') return false;
  try {
    const res = await fetch(apiUrl('/api/diagnostics'), {
      method: 'POST',
      credentials: credentialsMode(),
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'aide', ...authHeaders() },
      body: JSON.stringify({ reports }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

let sender: Sender = defaultSender;

/** Tests only. */
export function setDiagnosticsSender(next: Sender | null): void {
  sender = next ?? defaultSender;
  queue = [];
  sentThisSession = 0;
  seen.clear();
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
}

/** "Name: message" of any thrown value, including DOM ErrorEvent / Event objects thrown by workers. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof ErrorEvent !== 'undefined' && error instanceof ErrorEvent) {
    return `ErrorEvent: ${error.message || '(no message)'}${error.filename ? ` @ ${error.filename}:${error.lineno}` : ''}`;
  }
  if (typeof Event !== 'undefined' && error instanceof Event) return `Event: type=${error.type}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** Capability flags that explain most device-specific failures. */
export function deviceCapabilities(): Record<string, DiagnosticValue> {
  const g = globalThis as unknown as Record<string, unknown>;
  const nav = (typeof navigator === 'undefined' ? undefined : navigator) as (Navigator & { deviceMemory?: number }) | undefined;
  return {
    ipad: isIPad(),
    standalone: isStandalonePwa(),
    wasm: typeof g.WebAssembly === 'object',
    worker: typeof g.Worker === 'function',
    offscreenCanvas: typeof g.OffscreenCanvas === 'function',
    createImageBitmap: typeof g.createImageBitmap === 'function',
    swControlled: Boolean(nav && 'serviceWorker' in nav && nav.serviceWorker?.controller),
    secureContext: typeof g.isSecureContext === 'boolean' ? (g.isSecureContext as boolean) : null,
    deviceMemory: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null,
    hardwareConcurrency: typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
  };
}

function sanitizeContext(context: DiagnosticContext): Record<string, DiagnosticValue> {
  const out: Record<string, DiagnosticValue> = {};
  for (const [key, value] of Object.entries({ ...deviceCapabilities(), ...context })) {
    if (value === undefined) continue;
    if (Object.keys(out).length >= DIAGNOSTIC_LIMITS.contextKeysMax) break;
    const k = clip(key, DIAGNOSTIC_LIMITS.contextKeyMax);
    out[k] = typeof value === 'string' ? clip(value, DIAGNOSTIC_LIMITS.contextValueMax) : typeof value === 'number' && !Number.isFinite(value) ? null : value;
  }
  return out;
}

/** Queues a report (deduplicated per session) and sends it shortly after. Never throws. */
export function reportProblem(kind: ClientDiagnosticKind, error: unknown, stage: string | null = null, context: DiagnosticContext = {}): void {
  try {
    const message = clip(describeError(error), DIAGNOSTIC_LIMITS.messageMax);
    // A retry that finally fails is reported again (context.final), other duplicates only once per session.
    const key = `${kind}|${stage ?? ''}|${message}|${context.final === true ? 'final' : ''}`;
    if (seen.has(key) || sentThisSession + queue.length >= MAX_REPORTS_PER_SESSION) return;
    seen.add(key);
    queue.push({
      kind,
      message,
      stage: stage === null ? null : clip(stage, DIAGNOSTIC_LIMITS.stageMax),
      context: sanitizeContext(context),
      userAgent: clip(typeof navigator === 'undefined' ? '' : navigator.userAgent, DIAGNOSTIC_LIMITS.userAgentMax),
      occurredAt: Date.now(),
    });
    if (flushTimer === null) flushTimer = setTimeout(() => void flushDiagnostics(), FLUSH_DELAY_MS);
  } catch {
    // Diagnostics must never break the app.
  }
}

/** Sends queued reports now. Reports are dropped after a failed send (best effort, no retry storm). */
export async function flushDiagnostics(): Promise<void> {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  while (queue.length > 0) {
    const batch = queue.splice(0, DIAGNOSTIC_LIMITS.reportsMax);
    sentThisSession += batch.length;
    await sender(batch).catch(() => false);
  }
}
