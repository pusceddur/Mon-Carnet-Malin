import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PARENT_SETTINGS } from '@aide/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, makeDocument, makePage, newParent, type TestContext, unlock, XRW } from '../platform/helpers';

describe('app: headers, body limits, static client', () => {
  let ctx: TestContext;
  let clientDist: string;

  beforeAll(async () => {
    clientDist = mkdtempSync(join(tmpdir(), 'aide-client-'));
    mkdirSync(join(clientDist, 'ocr'), { recursive: true });
    mkdirSync(join(clientDist, 'assets'), { recursive: true });
    writeFileSync(join(clientDist, 'index.html'), '<!doctype html><title>Carnet</title>');
    writeFileSync(join(clientDist, 'ocr', 'fra.traineddata.gz'), Buffer.from([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3]));
    writeFileSync(join(clientDist, 'assets', 'index-abc.js'), 'export {};');
    ctx = await createTestContext({ clientDist, env: { TRUST_PROXY: '1' } });
  });
  afterAll(async () => {
    await ctx.close();
    rmSync(clientDist, { recursive: true, force: true });
  });

  it('CSP allows blob:/data: connections and wasm, forbids framing', async () => {
    const csp = (await request(ctx.app).get('/api/health')).headers['content-security-policy'] as string;
    expect(csp).toContain("connect-src 'self' blob: data:");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('trust proxy comes from TRUST_PROXY', () => {
    expect(ctx.app.get('trust proxy')).toBe(1);
  });

  it('serves OCR .gz files as opaque bytes without Content-Encoding', async () => {
    const res = await request(ctx.app).get('/ocr/fra.traineddata.gz');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-encoding']).toBeUndefined();
    const asset = await request(ctx.app).get('/assets/index-abc.js');
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const spa = await request(ctx.app).get('/livres');
    expect(spa.status).toBe(200);
    expect(spa.headers['cache-control']).toBe('no-cache');
    expect(spa.text).toContain('Carnet');
    expect((await request(ctx.app).get('/api/inconnu')).body.error.code).toBe('not_found');
  });

  it('JSON bodies: 2 MB for ordinary routes, 25 MB for /api/sync (413 payload_too_large JSON)', async () => {
    const { parent, agent } = await newParent(ctx, 'limites@example.fr');
    await unlock(agent);
    const big = { ...DEFAULT_PARENT_SETTINGS, padding: 'x'.repeat(2 * 1024 * 1024 + 10) };
    const tooBig = await agent.put('/api/settings').set(XRW).send(big);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body).toEqual({ error: { code: 'payload_too_large', message: expect.any(String) } });

    // ~3 MB of page text is fine through sync.
    const doc = makeDocument(parent.id);
    const blocks = Array.from({ length: 20 }, () => ({ kind: 'paragraph' as const, text: 'é'.repeat(80_000) }));
    const syncBody = { cursor: null, deviceId: 'd', changes: { documents: [doc], pages: [makePage(doc.id, { blocks })] } };
    const ok = await agent.post('/api/sync').set(XRW).send(syncBody);
    expect(ok.status).toBe(200);
    expect(ok.body.rejected).toEqual([]);
    expect(ok.body.changes.pages[0].blocks[0].text).toHaveLength(80_000);

    const huge = await agent.post('/api/sync').set(XRW).send({ cursor: null, deviceId: 'd', changes: {}, padding: 'y'.repeat(25 * 1024 * 1024 + 10) });
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe('payload_too_large');

    // Unauthenticated sync bodies are refused before being parsed.
    const anonymous = await request(ctx.app).post('/api/sync').set(XRW).send(syncBody);
    expect(anonymous.status).toBe(401);
  });
});
