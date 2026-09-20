// §29 App Store build of the iPad app.
//
// Unlike `ipad/` (the shell that opens the web site), this app carries its own copy of the web app inside the bundle:
// there is no `server.url`. That is what makes it an app rather than a browser pointed at a website, and it is why it
// opens and reads books with no network at all. Updates ship through the App Store.
//
// Because the web app runs from `capacitor://localhost` and the API lives on the server, the calls cross an origin:
// the server must list this origin in APP_ORIGINS, and the app authenticates with a bearer token (see client/src/api/endpoint.ts).
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
const apiBaseUrl = env.CARNET_API_BASE_URL;
if (!apiBaseUrl || !/^https:\/\/[^/]+\/?$/.test(apiBaseUrl)) {
  throw new Error('ios-app/.env: CARNET_API_BASE_URL must be the https address of the server (see .env.example)');
}

/** Scheme and host the bundled files are served from; together they are the origin the server has to allow. */
const IOS_SCHEME = 'capacitor';
const HOSTNAME = 'localhost';

/** Origin the server must list in APP_ORIGINS. */
const appOrigin = `${IOS_SCHEME}://${HOSTNAME}`;

/** @type {import('@capacitor/cli').CapacitorConfig & { appOrigin: string, apiBaseUrl: string }} */
module.exports = {
  appId: env.CARNET_APP_ID || 'app.carnetmalin.ios',
  appName: 'Carnet Malin',
  // Filled by scripts/build-web.mjs with the built client; never edited by hand.
  webDir: 'www',
  server: {
    iosScheme: IOS_SCHEME,
    hostname: HOSTNAME,
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#fffdf7',
    // The app owns every file it shows, so navigation never leaves the bundle and app-bound domains are not needed
    // (they exist to let a remote site run a service worker inside an app; this app has no remote site and no worker).
    limitsNavigationsToAppBoundDomains: false,
  },
  // Read by the scripts, not by Capacitor.
  appOrigin,
  apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
};
