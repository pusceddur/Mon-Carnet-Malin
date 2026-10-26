import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@aide/shared';
import { MockTransport } from '../../src/ai/MockTransport';
import type { AITransportOperation } from '../../src/ai/plugin';
import { type Agent, createTestContext, newChild, newParent, type TestContext, XRW } from '../platform/helpers';
import { SCIENCE_TEXT } from './helpers';

// A stand-in for LM Studio: /v1/chat/completions answers with the mock generator's output, or fails on demand.
const generator = new MockTransport();
let server: Server;
let baseUrl = '';
let failWith: number | null = null;
let received = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      void (async () => {
        received += 1;
        if (req.url !== '/v1/chat/completions' || failWith !== null) {
          res.writeHead(failWith ?? 404).end();
          return;
        }
        const body = JSON.parse(raw) as { messages: { content: string }[]; response_format: { json_schema: { name: AITransportOperation } } };
        const out = await generator.complete({
          tier: 'light', operation: body.response_format.json_schema.name, system: body.messages[0]!.content, documentText: body.messages[1]!.content,
          userText: body.messages[1]!.content, jsonSchema: {}, maxOutputTokens: 700, signal: new AbortController().signal, deadlineMs: 40_000,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          model: 'local-model', choices: [{ message: { content: JSON.stringify(out.json) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }));
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
  failWith = null;
  received = 0;
});

async function setup(env: Record<string, string>): Promise<{ ctx: TestContext; agent: Agent; childId: string }> {
  ctx = await createTestContext({ env: { OPENAI_BASE_URL: baseUrl, OPENAI_MODEL_LIGHT: 'local-model', AI_PROVIDER_COMPLEX: 'local', ...env } });
  const { agent } = await newParent(ctx, `oa-${newId().slice(0, 8)}@example.fr`);
  const child = await newChild(agent, 'Zoé');
  return { ctx, agent, childId: child.id };
}

function explain(agent: Agent, childId: string) {
  return agent.post('/api/ai/explain_text').set(XRW).send({
    childId, documentId: null, documentHash: null, text: SCIENCE_TEXT, paragraph: SCIENCE_TEXT, pageIndex: 0, ocrLowConfidence: false,
  });
}

describe('/api/ai with an OpenAI-compatible server', () => {
  it('answers through the local server', async () => {
    const { ctx: c, agent, childId } = await setup({ AI_PROVIDER_LIGHT: 'openai' });
    const res = await explain(agent, childId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', meta: { route: 'light' } });
    expect(await c.db('ai_requests').select('provider', 'model', 'status')).toEqual([{ provider: 'openai', model: 'local-model', status: 'ok' }]);
  });

  it('falls back to the second AI when the server is down', async () => {
    failWith = 503;
    const { ctx: c, agent, childId } = await setup({ AI_PROVIDER_LIGHT: 'openai', AI_FALLBACK_LIGHT: 'mock' });
    const res = await explain(agent, childId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(received).toBe(1);
    expect(await c.db('ai_requests').select('provider', 'model', 'status')).toEqual([{ provider: 'openai', model: 'mock:mock-light', status: 'ok' }]);
  });
});
