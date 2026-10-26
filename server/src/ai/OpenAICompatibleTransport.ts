// AI_PROVIDER=openai: any server speaking the OpenAI Chat Completions API — LM Studio, Ollama, vLLM, llama.cpp,
// LocalAI, OpenAI itself. One POST to {baseUrl}/chat/completions per request, no SDK.
//
// What leaves the server is exactly what RemoteProvider built: the static system prompt, the neutralized document
// block, the variable user text and, for handwriting only, one image. Never the parent id (see AITransportRequest).
import { AI_DEADLINES } from '@aide/shared';
import type { OpenAIConfig } from '../config';
import type { Logger } from '../logger';
import { AITransportError, type AITier, type AITransport, type AITransportErrorKind, type AITransportRequest, type AITransportResponse } from './plugin';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface OpenAICompatibleTransportOptions {
  config: OpenAIConfig;
  logger: Logger;
  /** Test hook. */
  fetch?: FetchLike;
}

const MICROS_PER_EUR = 1_000_000;

/** The model's text answer as JSON: reasoning blocks, code fences and chatter around the object are dropped. */
export function extractJson(content: string): unknown | null {
  const text = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function errorKindOf(status: number): AITransportErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'unavailable';
  return 'bad_request';
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('');
  }
  return '';
}

export class OpenAICompatibleTransport implements AITransport {
  readonly name = 'openai';
  readonly selfReferenceTerms: readonly string[];
  private readonly fetch: FetchLike;

  constructor(private readonly options: OpenAICompatibleTransportOptions) {
    const { config } = options;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.selfReferenceTerms = [...new Set([...config.selfReferenceTerms, ...[config.models.light, config.models.complex].filter((m): m is string => m !== null)])];
  }

  isConfigured(): boolean {
    return this.options.config.models.light !== null || this.options.config.models.complex !== null;
  }

  supports(tier: AITier): boolean {
    return this.options.config.models[tier] !== null;
  }

  async complete(req: AITransportRequest): Promise<AITransportResponse> {
    const { config, logger } = this.options;
    const model = config.models[req.tier];
    if (model === null) throw new AITransportError('unavailable', `no model for the ${req.tier} tier`);
    if (req.images && req.images.length > 0 && !config.images) throw new AITransportError('bad_request', 'images not enabled');
    if (req.signal.aborted) throw new AITransportError('timeout', 'aborted');

    // Never the whole deadline when a second AI comes after: services.ts counts this much for the first attempt.
    const timeoutMs = Math.max(1, Math.min(req.deadlineMs, config.timeoutMs ?? AI_DEADLINES[req.tier]));
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(timeoutMs)]);
    let response: Response;
    try {
      response = await this.fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(this.body(req, model)),
        signal,
      });
    } catch (err) {
      // Our own deadline, the router's, or nobody listening at the address (LM Studio closed, machine asleep).
      if (signal.aborted) throw new AITransportError('timeout', 'aborted');
      logger.warn('openai_unreachable', { error: err });
      throw new AITransportError('unavailable', 'unreachable');
    }

    if (!response.ok) {
      // The body may quote the prompt back: only the status is logged.
      logger.warn('openai_http_error', { status: response.status, model });
      throw new AITransportError(errorKindOf(response.status), `http ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AITransportError('unavailable', 'invalid response');
    }
    const choice = (payload as { choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[] }).choices?.[0];
    if (!choice) throw new AITransportError('unavailable', 'no choice');
    const usage = (payload as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage;
    const inputTokens = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : null;
    const outputTokens = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null;
    const refusal = typeof choice.message?.refusal === 'string' && choice.message.refusal.trim() !== '';

    return {
      json: refusal ? null : extractJson(contentText(choice.message?.content)),
      refusal,
      truncated: choice.finish_reason === 'length',
      model: typeof (payload as { model?: unknown }).model === 'string' ? (payload as { model: string }).model : model,
      inputTokens,
      outputTokens,
      costMicros: this.costMicros(inputTokens, outputTokens),
    };
  }

  private body(req: AITransportRequest, model: string): Record<string, unknown> {
    const { jsonMode } = this.options.config;
    // Without a schema the server can enforce, the model is told the shape in words.
    const system = jsonMode === 'json_schema'
      ? req.system
      : `${req.system}\n\nRéponds uniquement par un objet JSON valide, sans texte autour, conforme à ce schéma JSON :\n${JSON.stringify(req.jsonSchema)}`;
    // The document first and the variable part last: servers that cache prompt prefixes reuse the document.
    const text = req.documentText ? `${req.documentText}\n\n${req.userText}` : req.userText;
    const images = req.images ?? [];
    const content = images.length === 0
      ? text
      : [
          { type: 'text', text },
          ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.base64}` } })),
        ];
    return {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      max_tokens: req.maxOutputTokens,
      temperature: 0.2,
      stream: false,
      ...(jsonMode === 'json_schema'
        ? { response_format: { type: 'json_schema', json_schema: { name: req.operation, schema: req.jsonSchema, strict: false } } }
        : jsonMode === 'json_object'
          ? { response_format: { type: 'json_object' } }
          : {}),
    };
  }

  /** Null on a local server (free): only a priced remote service counts towards the monthly budget. */
  private costMicros(inputTokens: number | null, outputTokens: number | null): number | null {
    const { prices } = this.options.config;
    if (!prices || inputTokens === null || outputTokens === null) return null;
    return Math.round(((inputTokens * prices.inputEurPerMTok + outputTokens * prices.outputEurPerMTok) / 1_000_000) * MICROS_PER_EUR);
  }
}
