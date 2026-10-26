import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { LogLevel } from './logger';

export type NodeEnv = 'development' | 'production' | 'test';
/**
 * 'plugin' = external provider module loaded at runtime from AI_PLUGIN_PATH (kept outside the repository).
 * 'worker' = jobs queued in the database and executed by the external worker (§17).
 * 'openai' = any server speaking the OpenAI Chat Completions API (LM Studio, Ollama, vLLM, OpenAI…), see OPENAI_*.
 */
export type AIProviderName = 'plugin' | 'local' | 'mock' | 'worker' | 'openai';

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
    /**
     * The second AI, tried when the first one cannot answer (AI_FALLBACK, AI_FALLBACK_LIGHT/COMPLEX). Null = none.
     * Never 'local' (the deterministic answers are already the last resort) nor the first provider again.
     */
    fallbackLight: AIProviderName | null;
    fallbackComplex: AIProviderName | null;
  };
  /** OpenAI-compatible server (AI_PROVIDER=openai or AI_FALLBACK=openai). Null when OPENAI_BASE_URL is not set. */
  openai: OpenAIConfig | null;
  /** External worker (§17). */
  worker: {
    /** Lowercase hex sha256 of the worker bearer token (WORKER_TOKEN_SHA256); null = the worker routes answer 404. */
    tokenSha256: string | null;
    /** Names the worker's model could use to talk about itself (WORKER_SELF_REFERENCE_TERMS, comma separated). */
    selfReferenceTerms: readonly string[];
    /**
     * Budget of one run on the worker, per tier (regeneration included). The end-to-end deadline of a request adds
     * WORKER_PROTOCOL.queueGraceMs, so waiting behind another job never eats into this budget.
     */
    deadlines: { light: number; complex: number };
  };
  /** Raw values from env (resolve with paths.ts). */
  clientDistDir: string | null;
  dataDir: string | null;
  tessdataBestDir: string | null;
  wiktionaryEnabled: boolean;
  /** Express `trust proxy` hop count (TRUST_PROXY); false = disabled (default). */
  trustProxy: number | false;
  /**
   * §29 origins of the bundled native app allowed to call the API across origins (APP_ORIGINS, comma separated, e.g.
   * `capacitor://localhost`). Empty by default: the browser app is same-origin and needs no CORS at all.
   */
  appOrigins: readonly string[];
  /** Per-parent storage quota for uploaded originals and page images (UPLOAD_QUOTA_MB, default 2000). */
  uploadQuotaBytes: number;
  /** bcrypt cost factor (fast in tests). */
  passwordHashRounds: number;
  /**
   * §20 e-mails (password reset, confirmation of use every 180 days). Null = not configured: « Mot de passe oublié » is
   * unavailable and nobody is signed out for lack of confirmation.
   */
  mail: MailConfig | null;
  /**
   * Who answers for the data, shown on the privacy policy (/confidentialite). Null fields are printed as « à
   * compléter » so a missing value is visible on the page instead of silently absent.
   */
  legal: LegalConfig;
}

export interface LegalConfig {
  /** LEGAL_OPERATOR: name or company of whoever runs this server (the data controller). */
  operator: string | null;
  /** LEGAL_CONTACT: e-mail address for privacy requests. */
  contact: string | null;
  /** LEGAL_HOSTING: host and country of the server, e.g. « OVHcloud, France ». */
  hosting: string | null;
  /** LEGAL_AI_PROVIDERS: the AI services requests may reach, `;` separated, e.g. « OpenAI (États-Unis); Anthropic (États-Unis) ». */
  aiProviders: readonly string[];
}

export interface OpenAIConfig {
  /** OPENAI_BASE_URL, up to and including /v1, no trailing slash: http://localhost:1234/v1 for LM Studio. */
  baseUrl: string;
  /** OPENAI_API_KEY: none for a local server. */
  apiKey: string | null;
  /** OPENAI_MODEL, or OPENAI_MODEL_LIGHT / OPENAI_MODEL_COMPLEX per tier. A tier without a model is not served. */
  models: { light: string | null; complex: string | null };
  /**
   * OPENAI_JSON_MODE: how the answer is held to its JSON Schema. 'json_schema' (default: LM Studio, OpenAI, vLLM,
   * recent Ollama), 'json_object' (JSON only, the schema in the prompt), 'prompt' (servers that know neither).
   */
  jsonMode: 'json_schema' | 'json_object' | 'prompt';
  /** OPENAI_IMAGES: the model reads images (handwriting). Default true; false sends those requests to the fallback. */
  images: boolean;
  /** OPENAI_TIMEOUT_MS: longest wait for one answer, so that a fallback still has time. Default: AI_DEADLINES of the tier. */
  timeoutMs: number | null;
  /** OPENAI_PRICE_INPUT / OPENAI_PRICE_OUTPUT, € per million tokens: counted in the monthly budget. Null = free. */
  prices: { inputEurPerMTok: number; outputEurPerMTok: number } | null;
  /** OPENAI_SELF_REFERENCE_TERMS, comma separated, plus the model names. */
  selfReferenceTerms: readonly string[];
}

export interface MailConfig {
  host: string;
  port: number;
  /** TLS from the start (port 465) instead of STARTTLS. */
  secure: boolean;
  user: string | null;
  password: string | null;
  /** Sender, e.g. « Mon Carnet Malin <noreply@example.fr> ». */
  from: string;
  /** Address of the app used in the links (https://…, no trailing slash). */
  publicUrl: string;
}

const ProviderSchema = z.enum(['plugin', 'local', 'mock', 'worker', 'openai']);
const PriceSchema = z.string().regex(/^\d{1,4}(\.\d{1,6})?$/).transform(Number);
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
  AI_FALLBACK: ProviderSchema.optional(),
  AI_FALLBACK_LIGHT: ProviderSchema.optional(),
  AI_FALLBACK_COMPLEX: ProviderSchema.optional(),
  OPENAI_BASE_URL: z.string().regex(/^https?:\/\/[^\s/]+(\/[^\s]*)?$/).optional(),
  OPENAI_API_KEY: z.string().min(1).max(500).optional(),
  OPENAI_MODEL: z.string().min(1).max(200).optional(),
  OPENAI_MODEL_LIGHT: z.string().min(1).max(200).optional(),
  OPENAI_MODEL_COMPLEX: z.string().min(1).max(200).optional(),
  OPENAI_JSON_MODE: z.enum(['json_schema', 'json_object', 'prompt']).optional(),
  OPENAI_IMAGES: BoolSchema.optional(),
  OPENAI_TIMEOUT_MS: DurationMsSchema.optional(),
  OPENAI_PRICE_INPUT: PriceSchema.optional(),
  OPENAI_PRICE_OUTPUT: PriceSchema.optional(),
  OPENAI_SELF_REFERENCE_TERMS: z.string().max(2000).optional(),
  CLIENT_DIST_DIR: z.string().min(1).optional(),
  DATA_DIR: z.string().min(1).optional(),
  TESSDATA_BEST_DIR: z.string().min(1).optional(),
  WIKTIONARY_ENABLED: BoolSchema.default(true),
  TRUST_PROXY: z.union([z.enum(['false', 'off']), z.string().regex(/^\d{1,2}$/)]).optional(),
  APP_ORIGINS: z.string().max(500).optional(),
  UPLOAD_QUOTA_MB: z.string().regex(/^\d{1,7}$/).optional(),
  WORKER_TOKEN_SHA256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  WORKER_SELF_REFERENCE_TERMS: z.string().max(2000).optional(),
  WORKER_DEADLINE_LIGHT_MS: DurationMsSchema.optional(),
  WORKER_DEADLINE_COMPLEX_MS: DurationMsSchema.optional(),
  SMTP_HOST: z.string().min(1).max(255).optional(),
  SMTP_PORT: z.string().regex(/^\d{1,5}$/).optional(),
  SMTP_SECURE: BoolSchema.optional(),
  SMTP_USER: z.string().min(1).max(255).optional(),
  SMTP_PASSWORD: z.string().min(1).max(500).optional(),
  MAIL_FROM: z.string().min(3).max(255).optional(),
  PUBLIC_URL: z.string().regex(/^https?:\/\/[^\s/]+(\/[^\s]*)?$/).optional(),
  LEGAL_OPERATOR: z.string().max(200).optional(),
  LEGAL_CONTACT: z.string().max(200).optional(),
  LEGAL_HOSTING: z.string().max(200).optional(),
  LEGAL_AI_PROVIDERS: z.string().max(1000).optional(),
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

/** §29 origins of the native app: `scheme://host[:port]`, no path and no trailing slash. Anything else is dropped. */
function parseOrigins(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^\s/]+$/i;
  return [...new Set(raw.split(',').map((o) => o.trim()).filter((o) => origin.test(o)))];
}

function parseTrustProxy(raw: string | undefined): number | false {
  if (raw === undefined || !/^\d+$/.test(raw)) return false;
  const hops = Number(raw);
  return hops > 0 ? hops : false;
}

/** Mail settings when SMTP_HOST, MAIL_FROM and PUBLIC_URL are all set; port 465 = TLS from the start. */
function parseMail(e: z.infer<typeof EnvSchema>): MailConfig | null {
  if (!e.SMTP_HOST || !e.MAIL_FROM || !e.PUBLIC_URL) return null;
  const port = e.SMTP_PORT ? Number(e.SMTP_PORT) : 465;
  return {
    host: e.SMTP_HOST,
    port,
    secure: e.SMTP_SECURE ?? port === 465,
    user: e.SMTP_USER ?? null,
    password: e.SMTP_PASSWORD ?? null,
    from: e.MAIL_FROM,
    publicUrl: e.PUBLIC_URL.replace(/\/+$/, ''),
  };
}

function parseOpenAI(e: z.infer<typeof EnvSchema>): OpenAIConfig | null {
  if (!e.OPENAI_BASE_URL) return null;
  return {
    baseUrl: e.OPENAI_BASE_URL.replace(/\/+$/, ''),
    apiKey: e.OPENAI_API_KEY ?? null,
    models: { light: e.OPENAI_MODEL_LIGHT ?? e.OPENAI_MODEL ?? null, complex: e.OPENAI_MODEL_COMPLEX ?? e.OPENAI_MODEL ?? null },
    jsonMode: e.OPENAI_JSON_MODE ?? 'json_schema',
    images: e.OPENAI_IMAGES ?? true,
    timeoutMs: e.OPENAI_TIMEOUT_MS ?? null,
    prices: e.OPENAI_PRICE_INPUT !== undefined && e.OPENAI_PRICE_OUTPUT !== undefined
      ? { inputEurPerMTok: e.OPENAI_PRICE_INPUT, outputEurPerMTok: e.OPENAI_PRICE_OUTPUT }
      : null,
    selfReferenceTerms: parseTerms(e.OPENAI_SELF_REFERENCE_TERMS),
  };
}

/** The second AI of a tier: never the deterministic one, never the first provider again. */
function fallbackOf(first: AIProviderName, wanted: AIProviderName | undefined): AIProviderName | null {
  return wanted === undefined || wanted === 'local' || wanted === first ? null : wanted;
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
  // §17.4: without AI_PROVIDER, a plugin wins, then an OpenAI-compatible server, then a configured worker, then the
  // local provider.
  const defaultProvider: AIProviderName = e.AI_PROVIDER
    ?? (pluginPath ? 'plugin' : e.OPENAI_BASE_URL ? 'openai' : workerTokenSha256 ? 'worker' : 'local');
  const providerLight = e.AI_PROVIDER_LIGHT ?? defaultProvider;
  const providerComplex = e.AI_PROVIDER_COMPLEX ?? defaultProvider;

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
      providerLight,
      providerComplex,
      pluginPath,
      fallbackLight: fallbackOf(providerLight, e.AI_FALLBACK_LIGHT ?? e.AI_FALLBACK),
      fallbackComplex: fallbackOf(providerComplex, e.AI_FALLBACK_COMPLEX ?? e.AI_FALLBACK),
    },
    openai: parseOpenAI(e),
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
    appOrigins: parseOrigins(e.APP_ORIGINS),
    uploadQuotaBytes: Number(e.UPLOAD_QUOTA_MB ?? DEFAULT_UPLOAD_QUOTA_MB) * 1024 * 1024,
    passwordHashRounds: isTest ? 4 : 12,
    mail: parseMail(e),
    legal: {
      operator: e.LEGAL_OPERATOR ?? null,
      contact: e.LEGAL_CONTACT ?? null,
      hosting: e.LEGAL_HOSTING ?? null,
      aiProviders: (e.LEGAL_AI_PROVIDERS ?? '').split(';').map((p) => p.trim()).filter((p) => p.length > 0),
    },
  };
}
