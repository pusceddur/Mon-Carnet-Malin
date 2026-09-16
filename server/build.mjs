// Bundles the server for production (Node >= 20): CJS, npm packages external, @aide/shared inlined from source.
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const serverDir = dirname(fileURLToPath(import.meta.url));
const sharedEntry = resolve(serverDir, '../shared/src/index.ts');

/** Resolves @aide/shared to its TypeScript source so it is bundled (plugins run before `packages: 'external'`). */
const inlineSharedPlugin = {
  name: 'inline-aide-shared',
  setup(b) {
    b.onResolve({ filter: /^@aide\/shared$/ }, () => ({ path: sharedEntry }));
  },
};

rmSync(resolve(serverDir, 'dist'), { recursive: true, force: true });

await build({
  absWorkingDir: serverDir,
  entryPoints: {
    app: 'src/index.ts',
    migrate: 'scripts/migrate.ts',
    'create-parent': 'scripts/create-parent.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  bundle: true,
  packages: 'external',
  plugins: [inlineSharedPlugin],
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
});
