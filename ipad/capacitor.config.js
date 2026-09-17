// iPad app shell. The app opens the web app from the server (updates arrive without rebuilding) and adds the
// system voices plugin. Server address and bundle id come from ipad/.env (never versioned).
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !line.trim().startsWith('#')) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const env = { ...readEnvFile(join(__dirname, '.env')), ...process.env };
const serverUrl = env.CARNET_SERVER_URL;
if (!serverUrl || !/^https:\/\/[^/]+\/?$/.test(serverUrl)) {
  throw new Error('ipad/.env: CARNET_SERVER_URL must be the https address of the server (see .env.example)');
}

/** @type {import('@capacitor/cli').CapacitorConfig} */
module.exports = {
  appId: env.CARNET_APP_ID || 'app.carnetmalin.ipad',
  appName: 'Carnet Malin',
  webDir: 'www',
  server: {
    url: serverUrl.replace(/\/$/, ''),
    // Shown when the server cannot be reached before the offline copy exists (first launch without network).
    errorPath: 'index.html',
  },
  ios: {
    // Needed for the service worker (offline reading) inside the app; the domains are listed in Info.plist.
    limitsNavigationsToAppBoundDomains: true,
    contentInset: 'never',
    backgroundColor: '#fffdf7',
  },
};
