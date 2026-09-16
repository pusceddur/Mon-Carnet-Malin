export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const SECRET_KEY = /(pass(word|wd)?|pin)(_?hash)?$|secret|api[-_]?key|authorization|cookie|token$|^sid$/i;
const MAX_DEPTH = 5;

function sanitize(value: unknown, depth: number): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? value.toString() : value;
  }
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : sanitize(v, depth + 1);
  }
  return out;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Output sink; defaults to stdout (debug/info) and stderr (warn/error). */
  write?: (line: string, level: Exclude<LogLevel, 'silent'>) => void;
  base?: LogFields;
}

const defaultWrite = (line: string, level: Exclude<LogLevel, 'silent'>): void => {
  if (level === 'warn' || level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
};

/** Minimal JSON-lines logger. Keys that look like secrets are always redacted. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LEVEL_ORDER[options.level ?? 'info'];
  const write = options.write ?? defaultWrite;
  const base = options.base ?? {};

  const log = (level: Exclude<LogLevel, 'silent'>, message: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    const entry = sanitize({ ...base, ...fields }, 0) as LogFields;
    let line: string;
    try {
      line = JSON.stringify({ time: new Date().toISOString(), level, msg: message, ...entry });
    } catch {
      line = JSON.stringify({ time: new Date().toISOString(), level, msg: message, logError: 'unserializable_fields' });
    }
    write(line, level);
  };

  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  };
}

export const silentLogger: Logger = createLogger({ level: 'silent' });
