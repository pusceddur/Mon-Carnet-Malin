import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface ScriptModule {
  DOWNLOAD_URL: string;
  METADATA_URL: string;
  MIN_MODEL_BYTES: number;
  gitBlobSha1(bytes: Uint8Array): string;
  targetDirectory(env: Record<string, string | undefined>, cwd: string): string;
  verifyModel(bytes: Uint8Array, expected: { size: number; sha: string | null } | null): string | null;
  fetchTessdataBest(options: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
    force?: boolean;
  }): Promise<{ status: 'present' | 'downloaded'; path: string; size: number }>;
}

// The script is plain .mjs (runs without a build step); a variable specifier keeps it out of type resolution.
const SCRIPT = '../../scripts/fetch-tessdata-best.mjs';
const loadScript = async (): Promise<ScriptModule> => (await import(/* @vite-ignore */ SCRIPT)) as ScriptModule;

describe('fetch-tessdata-best script', () => {
  let dir: string;
  let script: ScriptModule;
  const model = Buffer.alloc(1_200_000, 42);

  beforeEach(async () => {
    script = await loadScript();
    dir = mkdtempSync(join(tmpdir(), 'tessdata-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function fakeFetch(options: { metadata?: unknown; metadataStatus?: number; body?: Buffer; headers?: Record<string, string> } = {}) {
    const calls: string[] = [];
    const fetchImpl = async (url: string): Promise<Response> => {
      calls.push(url);
      if (url === script.METADATA_URL) {
        if (options.metadataStatus && options.metadataStatus !== 200) return new Response('{}', { status: options.metadataStatus });
        return Response.json(options.metadata ?? { size: model.length, sha: script.gitBlobSha1(model) });
      }
      if (url === script.DOWNLOAD_URL) return new Response(options.body ?? model, { headers: options.headers });
      return new Response('not found', { status: 404 });
    };
    return { calls, fetchImpl };
  }

  it('computes git blob SHA-1 like git', () => {
    expect(script.gitBlobSha1(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('uses TESSDATA_BEST_DIR, else DATA_DIR/tessdata_best, else ./data/tessdata_best', () => {
    expect(script.targetDirectory({ TESSDATA_BEST_DIR: 'modeles' }, dir)).toBe(resolve(dir, 'modeles'));
    expect(script.targetDirectory({ DATA_DIR: 'donnees' }, dir)).toBe(join(resolve(dir, 'donnees'), 'tessdata_best'));
    expect(script.targetDirectory({}, dir)).toBe(join(resolve(dir, 'data'), 'tessdata_best'));
  });

  it('verifies size and checksum', () => {
    const expected = { size: model.length, sha: script.gitBlobSha1(model) };
    expect(script.verifyModel(model, expected)).toBeNull();
    expect(script.verifyModel(model.subarray(1), expected)).toMatch(/size mismatch/);
    expect(script.verifyModel(Buffer.alloc(model.length, 1), expected)).toBe('checksum mismatch');
    expect(script.verifyModel(model, null)).toBe('expected size unknown');
    expect(script.verifyModel(Buffer.alloc(10), { size: 10, sha: null })).toMatch(/too small/);
  });

  it('downloads and saves the verified model', async () => {
    const { fetchImpl } = fakeFetch();
    const result = await script.fetchTessdataBest({ env: {}, cwd: dir, fetchImpl });
    const target = join(dir, 'data', 'tessdata_best', 'fra.traineddata');
    expect(result).toEqual({ status: 'downloaded', path: target, size: model.length });
    expect(readFileSync(target).equals(model)).toBe(true);
    expect(existsSync(`${target}.part`)).toBe(false);
  });

  it('keeps a valid existing model without downloading it again', async () => {
    const target = join(dir, 'data', 'tessdata_best', 'fra.traineddata');
    mkdirSync(join(dir, 'data', 'tessdata_best'), { recursive: true });
    writeFileSync(target, model);
    const { calls, fetchImpl } = fakeFetch();
    expect((await script.fetchTessdataBest({ env: {}, cwd: dir, fetchImpl })).status).toBe('present');
    expect(calls).toEqual([script.METADATA_URL]);
  });

  it('refuses a truncated download and writes nothing', async () => {
    const { fetchImpl } = fakeFetch({ body: model.subarray(0, 900_000) });
    await expect(script.fetchTessdataBest({ env: {}, cwd: dir, fetchImpl })).rejects.toThrow(/size mismatch/);
    expect(existsSync(join(dir, 'data', 'tessdata_best', 'fra.traineddata'))).toBe(false);
  });

  it('falls back to Content-Length when the GitHub API is unavailable', async () => {
    const ok = fakeFetch({ metadataStatus: 403, headers: { 'Content-Length': String(model.length) } });
    expect((await script.fetchTessdataBest({ env: {}, cwd: dir, fetchImpl: ok.fetchImpl })).status).toBe('downloaded');

    const noSize = fakeFetch({ metadataStatus: 403 });
    await expect(script.fetchTessdataBest({ env: {}, cwd: dir, fetchImpl: noSize.fetchImpl, force: true })).rejects.toThrow(/expected size unknown/);
  });
});
