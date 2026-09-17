import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AppConfig } from '../config';
import { dataDir } from '../paths';
import { resolveFromApp } from './appRequire';

/** `best_int`: bundled npm language data (fast). `best`: float tessdata_best downloaded by scripts/fetch-tessdata-best.mjs. */
export type OcrServerModel = 'best' | 'best_int';

export interface ResolvedOcrModel {
  requested: OcrServerModel;
  model: OcrServerModel;
  /** Directory handed to tesseract.js as langPath (local path, never a URL). */
  langPath: string;
  gzip: boolean;
  /** Full path of the traineddata file. */
  file: string;
}

export const TESSDATA_BEST_FILE = 'fra.traineddata';
export const BEST_INT_FILE = 'fra.traineddata.gz';
export const DEFAULT_TESSDATA_BEST_SUBDIR = 'tessdata_best';

export function parseOcrServerModel(raw: string | undefined): OcrServerModel {
  const value = raw?.trim().toLowerCase().replace('-', '_');
  return value === 'best' ? 'best' : 'best_int';
}

/** Directory of the float model: TESSDATA_BEST_DIR, else `<DATA_DIR>/tessdata_best`. */
export function tessdataBestDir(config: AppConfig, cwd: string = process.cwd()): string {
  return config.tessdataBestDir ? resolve(cwd, config.tessdataBestDir) : join(dataDir(config, cwd), DEFAULT_TESSDATA_BEST_SUBDIR);
}

/** Directory of `@tesseract.js-data/fra/4.0.0_best_int`, or null when the package is not installed. */
export function bestIntLangPath(): string | null {
  const packageJson = resolveFromApp('@tesseract.js-data/fra/package.json');
  return packageJson ? join(dirname(packageJson), '4.0.0_best_int') : null;
}

export interface ResolveOcrModelInput {
  config: AppConfig;
  env?: Readonly<Record<string, string | undefined>>;
  cwd?: string;
  exists?: (path: string) => boolean;
  bestIntDir?: string | null;
}

/** Picks the model files to use; `best` falls back to `best_int` when not downloaded. Null when nothing is usable. */
export function resolveOcrModel(input: ResolveOcrModelInput): ResolvedOcrModel | null {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();
  const exists = input.exists ?? existsSync;
  const requested = parseOcrServerModel(env['OCR_SERVER_MODEL']);

  if (requested === 'best') {
    const dir = tessdataBestDir(input.config, cwd);
    const file = join(dir, TESSDATA_BEST_FILE);
    if (exists(file)) return { requested, model: 'best', langPath: dir, gzip: false, file };
  }
  const intDir = input.bestIntDir === undefined ? bestIntLangPath() : input.bestIntDir;
  if (intDir) {
    const file = join(intDir, BEST_INT_FILE);
    if (exists(file)) return { requested, model: 'best_int', langPath: intDir, gzip: true, file };
  }
  return null;
}
