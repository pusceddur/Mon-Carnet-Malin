// Finishes the generated Xcode project (run on the Mac after `cap add ios` / `cap sync ios`).
// Sets the app name, the orientations, the icon and the permission texts iOS shows the parent.
// Without a usage description iOS closes the app instead of asking, so every capability used by a native plugin needs one.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

const plutil = (...args) => execFileSync('plutil', [...args, plist], { stdio: 'inherit' });

plutil('-replace', 'CFBundleDisplayName', '-string', config.appName);
plutil('-replace', 'NSCameraUsageDescription', '-string', 'Prendre en photo les pages d’un livre pour les lire.');
plutil('-replace', 'NSPhotoLibraryUsageDescription', '-string', 'Choisir des photos de pages de livres à importer.');
// Used by the reading-aloud practice (speech recognition); harmless before that plugin exists.
plutil('-replace', 'NSMicrophoneUsageDescription', '-string', 'Écouter la lecture à voix haute pour aider l’enfant.');
plutil('-replace', 'NSSpeechRecognitionUsageDescription', '-string', 'Suivre la lecture à voix haute de l’enfant.');
plutil('-replace', 'UISupportedInterfaceOrientations~ipad', '-json', JSON.stringify([
  'UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown',
  'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight',
]));
// « Ouvrir dans Carnet Malin »: the kinds of document the app accepts from Mail, Safari, Fichiers and iCloud Drive.
// `Owner` (not `Alternate`) would claim the file types as ours, which they are not: the app only knows how to open them.
const documentTypes = [
  { name: 'PDF', types: ['com.adobe.pdf'] },
  { name: 'Livre EPUB', types: ['org.idpf.epub-container'] },
  { name: 'Image', types: ['public.jpeg', 'public.png', 'public.heic', 'org.webmproject.webp'] },
].map(({ name, types }) => ({
  CFBundleTypeName: name,
  CFBundleTypeRole: 'Viewer',
  LSHandlerRank: 'Alternate',
  LSItemContentTypes: types,
}));
plutil('-replace', 'CFBundleDocumentTypes', '-json', JSON.stringify(documentTypes));
// The bundle carries the whole app: nothing is loaded from the network at startup, so no exception is needed here.
console.log('configure-ios: Info.plist updated (document types: PDF, EPUB, images)');

// Icon: the web app icon resized to the single 1024 px icon of the template.
const sourceIcon = join(root, '..', 'client', 'public', 'icons', 'icon-512.png');
const targetIcon = join(appDir, 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png');
if (existsSync(sourceIcon) && existsSync(dirname(targetIcon))) {
  execFileSync('sips', ['-z', '1024', '1024', sourceIcon, '--out', targetIcon], { stdio: 'ignore' });
  console.log('configure-ios: app icon updated');
}

console.log(`configure-ios: the server must list ${config.appOrigin} in APP_ORIGINS`);
