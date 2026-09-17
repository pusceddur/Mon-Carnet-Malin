// Finishes the generated Xcode project (run on the Mac after `cap add ios` / `cap sync ios`):
// app-bound domains (service worker inside the app), app name, orientations, icon, server address of the offline page.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = createRequire(import.meta.url)(join(root, 'capacitor.config.js'));
const appDir = join(root, 'ios', 'App', 'App');
const plist = join(appDir, 'Info.plist');

if (process.platform !== 'darwin') {
  console.error('configure-ios: run this on the Mac (it uses plutil and sips).');
  process.exit(1);
}
if (!existsSync(plist)) {
  console.error('configure-ios: ios/App/App/Info.plist not found, run `npm run setup` first.');
  process.exit(1);
}

const host = new URL(config.server.url).hostname;
const plutil = (...args) => execFileSync('plutil', [...args, plist], { stdio: 'inherit' });

plutil('-replace', 'CFBundleDisplayName', '-string', config.appName);
// Without these texts the app is closed by iOS when the import page opens the camera or the photo library.
plutil('-replace', 'NSCameraUsageDescription', '-string', 'Prendre en photo les pages d’un livre pour les lire.');
plutil('-replace', 'NSPhotoLibraryUsageDescription', '-string', 'Choisir des photos de pages de livres à importer.');
// localhost = the local offline page (server.errorPath).
plutil('-replace', 'WKAppBoundDomains', '-json', JSON.stringify([host, 'localhost']));
plutil('-replace', 'UISupportedInterfaceOrientations~ipad', '-json', JSON.stringify([
  'UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown',
  'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight',
]));
console.log(`configure-ios: Info.plist updated (app-bound domains: ${host}, localhost)`);

// Icon: the web app icon resized to the single 1024 px icon of the template.
const sourceIcon = join(root, '..', 'client', 'public', 'icons', 'icon-512.png');
const targetIcon = join(appDir, 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png');
if (existsSync(sourceIcon) && existsSync(dirname(targetIcon))) {
  execFileSync('sips', ['-z', '1024', '1024', sourceIcon, '--out', targetIcon], { stdio: 'ignore' });
  console.log('configure-ios: app icon updated');
}

// Offline page: retry goes back to the server.
const offlinePage = join(appDir, 'public', 'index.html');
if (existsSync(offlinePage)) {
  writeFileSync(offlinePage, readFileSync(offlinePage, 'utf8').replace('__CARNET_SERVER_URL__', config.server.url));
  console.log('configure-ios: offline page updated');
}
