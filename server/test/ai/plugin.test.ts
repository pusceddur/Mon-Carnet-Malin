import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AITransportError, isAITransportError, loadAIPlugin } from '../../src/ai/plugin';
import { createLogger, type Logger } from '../../src/logger';

const dir = mkdtempSync(join(tmpdir(), 'aide-plugin-'));

const TRANSPORT_BODY = `{
    name: 'fixture',
    isConfigured: () => env.FIXTURE_READY === 'yes',
    supports: (tier) => tier === 'light',
    complete: async () => ({ json: { ok: true }, refusal: false, truncated: false, model: 'fixture-model', inputTokens: 1, outputTokens: 1, costMicros: 0 }),
    selfReferenceTerms: ['Fixture'],
  }`;

function fixture(name: string, content: string): string {
  const file = join(dir, name);
  writeFileSync(file, content, 'utf8');
  return file;
}

const esmPlugin = fixture('esm-plugin.mjs', `
export function createTransport(env, logger) {
  logger.info('fixture_created');
  return ${TRANSPORT_BODY};
}
`);

// Same shape as an esbuild CJS bundle (module.exports built at runtime).
const cjsPlugin = fixture('cjs-plugin.cjs', `
"use strict";
var exported = {};
Object.defineProperty(exported, 'createTransport', { enumerable: true, get: () => createTransport });
module.exports = exported;
function createTransport(env) {
  return ${TRANSPORT_BODY};
}
`);

const noFactory = fixture('no-factory.mjs', 'export const something = 1;\n');
const throwingFactory = fixture('throwing.mjs', "export function createTransport() { throw new Error('boom'); }\n");
const badTransport = fixture('bad-transport.mjs', "export function createTransport() { return { name: 'x' }; }\n");
const syntaxError = fixture('syntax-error.mjs', 'export function (\n');

function captureLogger(): { logger: Logger; messages: string[] } {
  const messages: string[] = [];
  const logger = createLogger({
    level: 'debug',
    write: (line) => {
      messages.push(String((JSON.parse(line) as { msg: unknown }).msg));
    },
  });
  return { logger, messages };
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadAIPlugin', () => {
  it('returns null without a path', async () => {
    const { logger, messages } = captureLogger();
    expect(await loadAIPlugin(null, logger)).toBeNull();
    expect(await loadAIPlugin('   ', logger)).toBeNull();
    expect(messages).toEqual([]);
  });

  it('loads an ESM plugin and passes env and logger to the factory', async () => {
    const { logger, messages } = captureLogger();
    process.env.FIXTURE_READY = 'yes';
    try {
      const transport = await loadAIPlugin(esmPlugin, logger);
      expect(transport).not.toBeNull();
      expect(transport?.name).toBe('fixture');
      expect(transport?.isConfigured()).toBe(true);
      expect(transport?.supports('light')).toBe(true);
      expect(transport?.supports('complex')).toBe(false);
      expect(transport?.selfReferenceTerms).toEqual(['Fixture']);
      const controller = new AbortController();
      const res = await transport?.complete({
        tier: 'light', operation: 'explain_word', system: 's', documentText: null, userText: 'u', jsonSchema: {},
        maxOutputTokens: 10, signal: controller.signal, deadlineMs: 1000,
      });
      expect(res?.json).toEqual({ ok: true });
      expect(messages).toContain('fixture_created');
      expect(messages).toContain('ai_plugin_loaded');
    } finally {
      delete process.env.FIXTURE_READY;
    }
  });

  it('loads a CJS bundle through a cwd-relative path', async () => {
    const { logger } = captureLogger();
    const transport = await loadAIPlugin(relative(process.cwd(), cjsPlugin), logger);
    expect(transport?.name).toBe('fixture');
    expect(transport?.isConfigured()).toBe(false);
  });

  it('never throws: invalid plugins are logged and yield null', async () => {
    const cases: [string, string][] = [
      [join(dir, 'missing.cjs'), 'ai_plugin_load_failed'],
      [syntaxError, 'ai_plugin_load_failed'],
      [noFactory, 'ai_plugin_invalid_module'],
      [throwingFactory, 'ai_plugin_load_failed'],
      [badTransport, 'ai_plugin_invalid_transport'],
    ];
    for (const [path, expected] of cases) {
      const { logger, messages } = captureLogger();
      await expect(loadAIPlugin(path, logger), path).resolves.toBeNull();
      expect(messages, path).toContain(expected);
    }
  });
});

describe('isAITransportError', () => {
  it('recognizes local and foreign copies of the error class', () => {
    expect(isAITransportError(new AITransportError('timeout', 'slow'))).toBe(true);
    expect(new AITransportError('auth', 'x').kind).toBe('auth');

    class ForeignTransportError extends Error {
      readonly kind: string;
      constructor(kind: string) {
        super('foreign');
        this.name = 'AITransportError';
        this.kind = kind;
      }
    }
    expect(isAITransportError(new ForeignTransportError('rate_limited'))).toBe(true);
    expect(isAITransportError(new ForeignTransportError('weird'))).toBe(false);
    expect(isAITransportError(new Error('plain'))).toBe(false);
    expect(isAITransportError({ name: 'AITransportError', kind: 'timeout' })).toBe(false);
  });
});
