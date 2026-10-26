import { describe, expect, it } from 'vitest';
import { FailoverTransport } from '../../src/ai/FailoverTransport';
import { MockTransport } from '../../src/ai/MockTransport';
import type { AITransportRequest } from '../../src/ai/plugin';
import { silentLogger } from '../../src/logger';

function request(overrides: Partial<AITransportRequest> = {}): AITransportRequest {
  return {
    tier: 'light', operation: 'explain_word', system: 's', documentText: null, userText: 'u', jsonSchema: {}, maxOutputTokens: 100,
    signal: new AbortController().signal, deadlineMs: 40_000, parentId: 'parent-1', ...overrides,
  };
}

function setup(first: MockTransport, second: MockTransport, clock = { now: 0 }): FailoverTransport {
  return new FailoverTransport(
    [{ transport: first, receivesParentId: false }, { transport: second, receivesParentId: true }],
    { logger: silentLogger, now: () => clock.now, cooldownMs: 60_000 },
  );
}

describe('AI 1 then AI 2', () => {
  it('answers with the first AI when it can, and says which one answered', async () => {
    const first = new MockTransport({ name: 'openai', fallback: () => ({ json: { a: 1 }, refusal: false, truncated: false, model: 'qwen', inputTokens: 1, outputTokens: 1, costMicros: null }) });
    const second = new MockTransport({ name: 'worker' });
    const res = await setup(first, second).complete(request());
    expect(res).toMatchObject({ json: { a: 1 }, model: 'openai:qwen' });
    expect(second.requests).toHaveLength(0);
    // The owner of the request only reaches the member allowed to know it.
    expect(first.requests[0]!.parentId).toBeUndefined();
  });

  it('sends the same request to the second AI when the first fails, then skips the first for a while', async () => {
    const clock = { now: 0 };
    const first = new MockTransport({ name: 'openai' });
    first.enqueue('explain_word', { error: 'unavailable' });
    const second = new MockTransport({ name: 'worker', fallback: () => ({ json: { b: 2 }, refusal: false, truncated: false, model: 'claude', inputTokens: 1, outputTokens: 1, costMicros: null }) });
    const failover = setup(first, second, clock);

    expect(await failover.complete(request())).toMatchObject({ json: { b: 2 }, model: 'worker:claude' });
    expect(second.requests[0]!.parentId).toBe('parent-1');
    expect(second.requests[0]!.userText).toBe('u');

    await failover.complete(request());
    expect(first.requests).toHaveLength(1); // resting
    clock.now = 61_000;
    await failover.complete(request());
    expect(first.requests).toHaveLength(2); // back
  });

  it('does not rest the first AI for a request it cannot take', async () => {
    const first = new MockTransport({ name: 'openai' });
    first.enqueue('explain_word', { error: 'bad_request' });
    const second = new MockTransport({ name: 'worker' });
    const failover = setup(first, second);
    await failover.complete(request());
    await failover.complete(request());
    expect(first.requests).toHaveLength(2);
  });

  it('fails like the last AI when both fail, and stops when the caller gave up', async () => {
    const first = new MockTransport({ name: 'openai' });
    const second = new MockTransport({ name: 'worker' });
    first.enqueue('explain_word', { error: 'unavailable' });
    second.enqueue('explain_word', { error: 'rate_limited' });
    await expect(setup(first, second).complete(request())).rejects.toMatchObject({ kind: 'rate_limited' });

    const aborted = new AbortController();
    aborted.abort();
    const a = new MockTransport({ name: 'openai' });
    const b = new MockTransport({ name: 'worker' });
    await expect(setup(a, b).complete(request({ signal: aborted.signal }))).rejects.toMatchObject({ kind: 'timeout' });
    expect(b.requests).toHaveLength(0);
  });

  it('serves a tier as soon as one AI does, and skips one that is not there', async () => {
    const first = new MockTransport({ name: 'openai', configured: false });
    const second = new MockTransport({ name: 'worker', tiers: ['light'] });
    const failover = setup(first, second);
    expect(failover.supports('light')).toBe(true);
    expect(failover.supports('complex')).toBe(false);
    await failover.complete(request());
    expect(first.requests).toHaveLength(0);
    expect(second.requests).toHaveLength(1);
  });
});
