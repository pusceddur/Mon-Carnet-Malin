import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppConfig } from './config';

// Paths are resolved from config or process.cwd() only: the production bundle is CJS and dev runs as ESM,
// so __dirname / import.meta.url are deliberately not used.

/** Built client directory (index.html), or null when not found. */
export function clientDistDir(config: AppConfig, cwd: string = process.cwd()): string | null {
  const candidates = config.clientDistDir
    ? [resolve(cwd, config.clientDistDir)]
    : [resolve(cwd, 'client', 'dist'), resolve(cwd, '..', 'client', 'dist')];
  return candidates.find((dir) => existsSync(resolve(dir, 'index.html'))) ?? null;
}

/** Writable data directory (uploaded originals, sqlite files, caches). Not created here. */
export function dataDir(config: AppConfig, cwd: string = process.cwd()): string {
  return resolve(cwd, config.dataDir ?? 'data');
}
