import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

// The server runs as ESM in development and as a CJS bundle in production, so packages are resolved from the
// application root (working directory), then from the entry script, never from this file's location.
function requireBases(): string[] {
  const bases = [join(process.cwd(), 'noop.js')];
  if (process.argv[1]) bases.push(resolve(process.argv[1]));
  return bases;
}

/** Absolute path of a package file, or null when it is not installed. */
export function resolveFromApp(id: string): string | null {
  for (const base of requireBases()) {
    try {
      return createRequire(base).resolve(id);
    } catch {
      // try the next base
    }
  }
  return null;
}

/** Loads a CommonJS package installed for the application. Throws when it is missing. */
export function requireFromApp<T>(id: string): T {
  const path = resolveFromApp(id);
  if (!path) throw new Error(`Package not installed: ${id}`);
  return createRequire(path)(path) as T;
}
