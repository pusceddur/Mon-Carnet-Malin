// Public, provider-neutral contract of the external AI transport plugin (§15.1).
// The plugin lives outside this repository and is loaded at runtime from AI_PLUGIN_PATH.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AIOperation } from '@aide/shared';
import type { Logger } from '../logger';

export type AITier = 'light' | 'complex';
export type AITransportOperation = AIOperation | 'summarize_chunk' | 'summarize_final';

export interface AITransportRequest {
  tier: AITier;
  operation: AITransportOperation;
  system: string;                        // static per operation (stable, cacheable prefix)
  documentText: string | null;           // UNTRUSTED content, already neutralized; the transport puts it in a cacheable block
  userText: string;                      // variable part (selection, question, parameters)
  jsonSchema: Record<string, unknown>;   // JSON Schema of the expected output (z.toJSONSchema)
  maxOutputTokens: number;
  images?: { mediaType: 'image/png' | 'image/jpeg'; base64: string }[];
  signal: AbortSignal;
  deadlineMs: number;
  /**
   * Account owning the request: only given to the built-in worker queue transport (job ownership, §17.4).
   * Never part of a prompt; external transports never receive it.
   */
  parentId?: string;
}

export interface AITransportResponse {
  json: unknown | null;
  refusal: boolean;
  truncated: boolean;
  model: string;                          // server log only (ai_requests), never sent to the client
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
}

export type AITransportErrorKind = 'timeout' | 'rate_limited' | 'unavailable' | 'bad_request' | 'auth';

const TRANSPORT_ERROR_KINDS: ReadonlySet<string> = new Set<AITransportErrorKind>(['timeout', 'rate_limited', 'unavailable', 'bad_request', 'auth']);

export class AITransportError extends Error {
  readonly kind: AITransportErrorKind;

  constructor(kind: AITransportErrorKind, message: string) {
    super(message);
    this.name = 'AITransportError';
    this.kind = kind;
  }
}

/**
 * True for an AITransportError, including one created by the plugin's own bundled copy of the class
 * (`instanceof` fails across bundles, so the name and kind are checked too).
 */
export function isAITransportError(err: unknown): err is AITransportError {
  if (err instanceof AITransportError) return true;
  if (!(err instanceof Error) || err.name !== 'AITransportError') return false;
  const kind = (err as { kind?: unknown }).kind;
  return typeof kind === 'string' && TRANSPORT_ERROR_KINDS.has(kind);
}

export interface AITransport {
  readonly name: string;                  // logs only
  isConfigured(): boolean;
  supports(tier: AITier): boolean;
  complete(req: AITransportRequest): Promise<AITransportResponse>;   // errors -> AITransportError
  readonly selfReferenceTerms: readonly string[];                     // brand/model names for SafetyGuard
  /** Optional: refreshes the cached availability read by `supports` (never throws). */
  refresh?(): Promise<void>;
}

export interface AIPluginModule {
  createTransport(env: Readonly<Record<string, string | undefined>>, logger: Logger): AITransport;
}

type CreateTransport = AIPluginModule['createTransport'];

function pickCreateTransport(mod: unknown): CreateTransport | null {
  // ESM: named export. CJS through import(): named export (cjs-module-lexer) or `default` = module.exports.
  let current: unknown = mod;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth++) {
    const candidate = (current as { createTransport?: unknown }).createTransport;
    if (typeof candidate === 'function') return candidate as CreateTransport;
    current = (current as { default?: unknown }).default;
  }
  return null;
}

function isTransport(value: unknown): value is AITransport {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Partial<Record<keyof AITransport, unknown>>;
  return typeof t.name === 'string'
    && typeof t.isConfigured === 'function'
    && typeof t.supports === 'function'
    && typeof t.complete === 'function'
    && Array.isArray(t.selfReferenceTerms)
    && t.selfReferenceTerms.every((term) => typeof term === 'string');
}

/**
 * Loads the transport plugin with a dynamic import() of `path` (resolved against process.cwd()).
 * Works from tsx (ESM) and from the esbuild CJS bundle: esbuild keeps non-literal import() as-is for node20 targets.
 * Never throws: any failure is logged and yields null (the server then runs without external AI).
 */
export async function loadAIPlugin(path: string | null, logger: Logger): Promise<AITransport | null> {
  if (path === null || path.trim() === '') return null;
  const absolutePath = resolve(process.cwd(), path.trim());
  try {
    const mod: unknown = await import(pathToFileURL(absolutePath).href);
    const createTransport = pickCreateTransport(mod);
    if (!createTransport) {
      logger.error('ai_plugin_invalid_module', { path: absolutePath });
      return null;
    }
    const transport: unknown = createTransport(process.env, logger.child({ component: 'ai_plugin' }));
    if (!isTransport(transport)) {
      logger.error('ai_plugin_invalid_transport', { path: absolutePath });
      return null;
    }
    logger.info('ai_plugin_loaded', { transport: transport.name, configured: transport.isConfigured() });
    return transport;
  } catch (err) {
    logger.error('ai_plugin_load_failed', { path: absolutePath, error: err });
    return null;
  }
}
