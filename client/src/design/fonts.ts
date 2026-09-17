// Self-hosted reading fonts, weights 400 and 700 (precached by the service worker).
// Only the latin and latin-ext subsets are bundled: latin already covers French (é, ç, œ, « », ’, …, €).
import '@fontsource/lexend/latin-400.css';
import '@fontsource/lexend/latin-700.css';
import '@fontsource/lexend/latin-ext-400.css';
import '@fontsource/lexend/latin-ext-700.css';
import '@fontsource/andika/latin-400.css';
import '@fontsource/andika/latin-700.css';
import '@fontsource/andika/latin-ext-400.css';
import '@fontsource/andika/latin-ext-700.css';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource/atkinson-hyperlegible/latin-ext-400.css';
import '@fontsource/atkinson-hyperlegible/latin-ext-700.css';
import '@fontsource/opendyslexic/latin-400.css';
import '@fontsource/opendyslexic/latin-700.css';

interface FontFaceSetLike {
  ready: Promise<unknown>;
}

/**
 * Resolves once the web fonts in use have loaded (or immediately when the Font Loading API is missing).
 * Useful to recompute layout-dependent positions (annotation anchors) after the reading font swaps in.
 */
export async function whenFontsReady(doc: { fonts?: FontFaceSetLike } = document): Promise<void> {
  const fonts = doc.fonts;
  if (!fonts || typeof fonts.ready?.then !== 'function') return;
  try {
    await fonts.ready;
  } catch {
    // Font loading failures fall back to system fonts; nothing to recover.
  }
}
