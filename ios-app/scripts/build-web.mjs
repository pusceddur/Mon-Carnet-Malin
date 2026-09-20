// Builds the web app for the App Store bundle and copies it into ios-app/www.
//
// The only difference with the ordinary web build is VITE_API_BASE_URL: inside the app the pages are local, so the API
// calls need the full address of the server. Run from ios-app/ with `npm run build`.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const repoRoot = resolve(appDir, '..');
const config = createRequire(import.meta.url)(join(appDir, 'capacitor.config.js'));
const clientDist = join(repoRoot, 'client', 'dist');
const target = join(appDir, config.webDir);

function log(message) {
  process.stdout.write(`[build-web] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[build-web] ERROR: ${message}\n`);
  process.exit(1);
}

log(`API base URL: ${config.apiBaseUrl}`);
log(`app origin (must be in the server's APP_ORIGINS): ${config.appOrigin}`);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const built = spawnSync(npm, ['run', 'build', '-w', 'client'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_API_BASE_URL: config.apiBaseUrl },
});
if (built.status !== 0) fail('the client build failed');
if (!existsSync(join(clientDist, 'index.html'))) fail(`no index.html in ${clientDist}`);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(clientDist, target, { recursive: true });

// The service worker belongs to the web site: inside the app the files are already local and updates come from the
// App Store. Leaving it in the bundle would only let iOS register a worker that can never serve anything useful.
const isServiceWorker = (name) => name === 'sw.js' || name === 'registerSW.js' || /^workbox-[\w.-]+\.js$/.test(name);
const removed = readdirSync(target).filter(isServiceWorker);
for (const name of removed) rmSync(join(target, name), { force: true });
if (removed.length > 0) log(`service worker files removed from the bundle: ${removed.join(', ')}`);

log(`web app copied into ${target}`);
log('next: npm run sync, then open Xcode');
