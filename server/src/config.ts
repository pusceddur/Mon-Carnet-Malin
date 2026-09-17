import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { LogLevel } from './logger';

export type NodeEnv = 'development' | 'production' | 'test';
/**
 * 'plugin' = external provider module loaded at runtime from AI_PLUGIN_PATH (kept outside the repository).
 * 'worker' = jobs queued in the database and executed by the external worker (§17).
 */
export type AIProviderName = 'plugin' | 'local' | 'mock' | 'worker';

export interface AppConfig {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  isTest: boolean;
  /** Number, or a socket/pipe name when the host provides one. */
  port: number | string;
  logLevel: LogLevel;
  databaseUrl: string;
  setupToken: string | null;
  sessionSecret: string | null;
  ai: {
    providerLight: AIProviderName;
    providerComplex: AIProviderName;
    /** Absolute or cwd-relative path of the external provider module, or null. */
    pluginPath: string | null;
  };
  /** External worker (§17). */
  worker: {
    /** Lowercase hex sha256 of the worker bearer token (WORKER_TOKEN_SHA256); null = the worker routes answer 404. */
    tokenSha256: string | null;
    /** Names the worker's model could use to talk about itself (WORKER_SELF_REFERENCE_TERMS, comma separated). */
    selfReferenceTerms: readonly string[];
    /** End-to-end deadlines of AI requests served by the worker (regeneration included). */
    deadlines: { light: number; complex: number };
  };
  /** Raw values from env (resolve with paths.ts). */
  clientDistDir: string | null;
  dataDir: string | null;
  tessdataBestDir: string | null;
  wiktionaryEnabled: boolean;
  /** Express `trust proxy` hop count (TRUST_PROXY); false = disabled (default). */
  trustProxy: number | false;
  /** Per-parent storage quota for uploaded originals and page images (UPLOAD_QUOTA_MB, default 2000). */
  uploadQuotaBytes: number;
  /** bcrypt cost factor (fast in tests). */
  passwordHashRounds: number;
}

const ProviderSchema = z.enum(['plugin', 'local', 'mock', 'worker']);
const DurationMsSchema = z.string().regex(/^\d{4,7}$/).transform(Number).pipe(z.number().int().min(5_000).max(3_600_000));
const BoolSchema = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),
  DATABASE_URL: z
    .string()
    .regex(/^(mysql2?:\/\/|sqlite:)/, 'must start with mysql:// or sqlite:')
    .optional(),
  SETUP_TOKEN: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(1).optional(),
  AI_PROVIDER: ProviderSchema.optional(),
  AI_PROVIDER_LIGHT: ProviderSchema.optional(),
  AI_PROVIDER_COMPLEX: ProviderSchema.optional(),
  AI_PLUGIN_PATH: z.string().min(1).optional(),
  CLIENT_DIST_DIR: z.string().min(1).optional(),
  DATA_DIR: z.string().min(1).optional(),
  TESSDATA_BEST_DIR: z.string().min(1).optional(),
  WIKTIONARY_ENABLED: BoolSchema.default(true),
  TRUST_PROXY: z.union([z.enum(['false', 'off']), z.string().regex(/^\d{1,2}$/)]).optional(),
  UPLOAD_QUOTA_MB: z.string().regex(/^\d{1,7}$/).optional(),
  WORKER_TOKEN_SHA256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  WORKER_SELF_REFERENCE_TERMS: z.string().max(2000).optional(),
  WORKER_DEADLINE_LIGHT_MS: DurationMsSchema.optional(),
  WORKER_DEADLINE_COMPLEX_MS: DurationMsSchema.optional(),
});

/** Loads `.env` from the working directory if present (does not override existing variables). */
export function loadEnvFileIfPresent(path: string = resolve(process.cwd(), '.env')): boolean {
  if (typeof process.loadEnvFile !== 'function' || !existsSync(path)) return false;
  try {
    process.loadEnvFile(path);
    return true;
  } catch {
    return false;
  }
}

const DEFAULT_UPLOAD_QUOTA_MB = 2000;
/** §17.4 default deadlines of AI requests served by the external worker. */
export const WORKER_DEFAULT_DEADLINES = { light: 90_000, complex: 240_000 } as const;

function parseTerms(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return [...new Set(raw.split(',').map((t) => t.trim()).filter((t) => t.length > 0 && t.length <= 100))];
}

function parseTrustProxy(raw: string | undefined): number | false {
  if (raw === undefined || !/^\d+$/.test(raw)) return false;
  const hops = Number(raw);
  return hops > 0 ? hops : false;
}

function parsePort(raw: string | undefined): number | string {
  if (raw === undefined) return 3001;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

/** Parses environment variables into a typed config. Throws with variable names only (never values). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string' && v.trim() !== '') cleaned[k] = v.trim();
  }
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const vars = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))].join(', ');
    throw new Error(`Invalid configuration for environment variable(s): ${vars}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  const isTest = e.NODE_ENV === 'test';

  let databaseUrl = e.DATABASE_URL;
  if (isProduction) {
    if (!databaseUrl || !/^mysql2?:\/\//.test(databaseUrl)) {
      throw new Error('DATABASE_URL must be a mysql:// URL in production');
    }
  } else if (!databaseUrl) {
    databaseUrl = isTest ? 'sqlite::memory:' : 'sqlite:./data/dev.sqlite';
  }

  const pluginPath = e.AI_PLUGIN_PATH ?? null;
  const workerTokenSha256 = e.WORKER_TOKEN_SHA256?.toLowerCase() ?? null;
  // §17.4: without AI_PROVIDER, a plugin wins, then a configured worker, then the local provider.
  const defaultProvider: AIProviderName = e.AI_PROVIDER ?? (pluginPath ? 'plugin' : workerTokenSha256 ? 'worker' : 'local');

  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    isTest,
    port: parsePort(e.PORT),
    logLevel: e.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
    databaseUrl,
    setupToken: e.SETUP_TOKEN ?? null,
    sessionSecret: e.SESSION_SECRET ?? null,
    ai: {
      providerLight: e.AI_PROVIDER_LIGHT ?? defaultProvider,
      providerComplex: e.AI_PROVIDER_COMPLEX ?? defaultProvider,
      pluginPath,
    },
    worker: {
      tokenSha256: workerTokenSha256,
      selfReferenceTerms: parseTerms(e.WORKER_SELF_REFERENCE_TERMS),
      deadlines: {
        light: e.WORKER_DEADLINE_LIGHT_MS ?? WORKER_DEFAULT_DEADLINES.light,
        complex: e.WORKER_DEADLINE_COMPLEX_MS ?? WORKER_DEFAULT_DEADLINES.complex,
      },
    },
    clientDistDir: e.CLIENT_DIST_DIR ?? null,
    dataDir: e.DATA_DIR ?? null,
    tessdataBestDir: e.TESSDATA_BEST_DIR ?? null,
    wiktionaryEnabled: e.WIKTIONARY_ENABLED,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    uploadQuotaBytes: Number(e.UPLOAD_QUOTA_MB ?? DEFAULT_UPLOAD_QUOTA_MB) * 1024 * 1024,
    passwordHashRounds: isTest ? 4 : 12,
  };
}
