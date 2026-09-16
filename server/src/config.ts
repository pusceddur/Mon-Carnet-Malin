import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { LogLevel } from './logger';

export type NodeEnv = 'development' | 'production' | 'test';
/** 'plugin' = external provider module loaded at runtime from AI_PLUGIN_PATH (kept outside the repository). */
export type AIProviderName = 'plugin' | 'local' | 'mock';

export interface AppConfig {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  isTest: boolean;
  /** Number, or a socket/pipe name when provided by Passenger. */
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
  /** Raw values from env (resolve with paths.ts). */
  clientDistDir: string | null;
  dataDir: string | null;
  tessdataBestDir: string | null;
  wiktionaryEnabled: boolean;
}

const ProviderSchema = z.enum(['plugin', 'local', 'mock']);
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
  const defaultProvider: AIProviderName = e.AI_PROVIDER ?? (pluginPath ? 'plugin' : 'local');

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
    clientDistDir: e.CLIENT_DIST_DIR ?? null,
    dataDir: e.DATA_DIR ?? null,
    tessdataBestDir: e.TESSDATA_BEST_DIR ?? null,
    wiktionaryEnabled: e.WIKTIONARY_ENABLED,
  };
}
