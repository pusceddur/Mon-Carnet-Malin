import { defineConfig } from 'vitest/config';

const testGlobs = ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'];

export default defineConfig({
  test: {
    projects: [
      {
        root: './shared',
        test: { name: 'shared', include: testGlobs, environment: 'node' },
      },
      {
        root: './server',
        test: { name: 'server', include: testGlobs, environment: 'node', testTimeout: 20_000 },
      },
      {
        root: './client',
        oxc: { jsx: { runtime: 'automatic' } },
        test: {
          name: 'client',
          include: testGlobs,
          environment: 'happy-dom',
          setupFiles: ['fake-indexeddb/auto'],
        },
      },
    ],
  },
});
