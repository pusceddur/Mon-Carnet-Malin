// Starts the built server bundle for Playwright with a fresh SQLite database in a temporary directory.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const bundle = resolve(root, 'server/dist/app.cjs');
const clientIndex = resolve(root, 'client/dist/index.html');
if (!existsSync(bundle) || !existsSync(clientIndex)) {
  process.stderr.write('e2e: run `npm run build` first (server/dist/app.cjs and client/dist are required).\n');
  process.exit(1);
}

const dataDir = join(tmpdir(), `aide-e2e-${process.env.E2E_PORT ?? '4319'}`);
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

process.env.DATA_DIR = dataDir;
process.env.DATABASE_URL = `sqlite:${join(dataDir, 'e2e.sqlite')}`;

createRequire(import.meta.url)(bundle);
