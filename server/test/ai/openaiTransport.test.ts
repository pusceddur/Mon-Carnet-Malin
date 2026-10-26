import { describe, expect, it } from 'vitest';
import type { OpenAIConfig } from '../../src/config';
import { extractJson, OpenAICompatibleTransport } from '../../src/ai/OpenAICompatibleTransport';
import type { AITransportRequest } from '../../src/ai/plugin';
import { silentLogger } from '../../src/logger';

const CONFIG: OpenAIConfig = {
  baseUrl: 'http://localhost:1234/v1', apiKey: null, models: { light: 'qwen3-8b', complex: null }, jsonMode: 'json_schema', images: true,
  timeoutMs: null, prices: null, selfReferenceTerms: [],
};

function request(overrides: Partial<AITransportRequest> = {}): AITransportRequest {
  return {
    tier: 'light', operation: 'explain_word', system: 'Tu expliques.', documentText: '<texte_du_document>Le chat.</texte_du_document>',
    userText: 'Explique « chat ».', jsonSchema: { type: 'object' }, maxOutputTokens: 700, signal: new AbortController().signal, deadlineMs: 40_000,
    ...overrides,
  };
}

interface Call { url: string; init: RequestInit; body: Record<string, unknown> }

function transport(answer: (call: Call) => Response | Promise<Response>, config: Partial<OpenAIConfig> = {}): { t: OpenAICompatibleTransport; calls: Call[] } {
  const calls: Call[] = [];
  const t = new OpenAICompatibleTransport({
    config: { ...CONFIG, ...config },
    logger: silentLogger,
    fetch: async (url, init) => {
      const call = { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
      calls.push(call);
      return answer(call);
    },
  });
  return { t, calls };
}

function ok(content: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({
    model: 'qwen3-8b', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 30 }, ...extra,
  });
}

describe('OpenAI-compatible transport', () => {
  it('posts one chat completion with the system prompt, the document then the question, and the JSON Schema', async () => {
    const { t, calls } = transport(() => ok('{"status":"ok"}'));
    const res = await t.complete(request());
    expect(calls[0]!.url).toBe('http://localhost:1234/v1/chat/completions');
    expect(new Headers(calls[0]!.init.headers).has('authorization')).toBe(false);
    expect(calls[0]!.body).toMatchObject({
      model: 'qwen3-8b', max_tokens: 700, stream: false,
      messages: [{ role: 'system', content: 'Tu expliques.' }, { role: 'user', content: '<texte_du_document>Le chat.</texte_du_document>\n\nExplique « chat ».' }],
      response_format: { type: 'json_schema', json_schema: { name: 'explain_word', schema: { type: 'object' } } },
    });
    expect(res).toEqual({ json: { status: 'ok' }, refusal: false, truncated: false, model: 'qwen3-8b', inputTokens: 120, outputTokens: 30, costMicros: null });
  });

  it('never sends the owner of the request', async () => {
    const { t, calls } = transport(() => ok('{}'));
    await t.complete(request({ parentId: 'parent-1' }));
    expect(JSON.stringify(calls[0]!.body)).not.toContain('parent-1');
  });

  it('sends the API key, images as data URLs, and counts the cost of a priced service', async () => {
    const { t, calls } = transport(() => ok('{}'), { apiKey: 'sk-test', prices: { inputEurPerMTok: 1, outputEurPerMTok: 2 } });
    const res = await t.complete(request({ documentText: null, images: [{ mediaType: 'image/png', base64: 'AAAA' }] }));
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer sk-test');
    const user = (calls[0]!.body.messages as { content: unknown }[])[1]!.content;
    expect(user).toEqual([{ type: 'text', text: 'Explique « chat ».' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }]);
    expect(res.costMicros).toBe(180); // (120 × 1 + 30 × 2) / 1e6 € = 0.00018 €
  });

  it('puts the schema in the prompt when the server cannot enforce it', async () => {
    const { t, calls } = transport(() => ok('{}'), { jsonMode: 'prompt' });
    await t.complete(request());
    expect(calls[0]!.body.response_format).toBeUndefined();
    expect((calls[0]!.body.messages as { content: string }[])[0]!.content).toContain('{"type":"object"}');
  });

  it('reads JSON wrapped in reasoning, fences or chatter, and reports truncation and refusals', async () => {
    expect(extractJson('<think>hmm {"a":0}</think>\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Voici : {"a":2} !')).toEqual({ a: 2 });
    expect(extractJson('pas de JSON')).toBeNull();
    const truncated = transport(() => Response.json({ choices: [{ message: { content: '{"a":' }, finish_reason: 'length' }] }));
    expect(await truncated.t.complete(request())).toMatchObject({ json: null, truncated: true, model: 'qwen3-8b', inputTokens: null });
    const refused = transport(() => Response.json({ choices: [{ message: { content: null, refusal: 'Non.' }, finish_reason: 'stop' }] }));
    expect(await refused.t.complete(request())).toMatchObject({ refusal: true, json: null });
  });

  it('maps HTTP failures and an unreachable server to transport errors', async () => {
    const kinds: [number, string][] = [[401, 'auth'], [429, 'rate_limited'], [503, 'unavailable'], [400, 'bad_request'], [504, 'timeout']];
    for (const [status, kind] of kinds) {
      const { t } = transport(() => new Response('boom', { status }));
      await expect(t.complete(request())).rejects.toMatchObject({ name: 'AITransportError', kind });
    }
    const down = transport(() => Promise.reject(new TypeError('fetch failed')));
    await expect(down.t.complete(request())).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('serves only the tiers that have a model, and images only when enabled', async () => {
    const { t, calls } = transport(() => ok('{}'), { images: false });
    expect(t.supports('light')).toBe(true);
    expect(t.supports('complex')).toBe(false);
    await expect(t.complete(request({ tier: 'complex' }))).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(t.complete(request({ images: [{ mediaType: 'image/png', base64: 'AAAA' }] }))).rejects.toMatchObject({ kind: 'bad_request' });
    expect(calls).toHaveLength(0);
  });

  it('gives up at its own timeout', async () => {
    const { t } = transport((call) => new Promise((_, reject) => {
      call.init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }), { timeoutMs: 20 });
    await expect(t.complete(request())).rejects.toMatchObject({ kind: 'timeout' });
  });
});
