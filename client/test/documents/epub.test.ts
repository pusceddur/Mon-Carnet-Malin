import { DocumentMetaSchema, PageContentSchema, type TextBlock } from '@aide/shared';
import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { computeContentHash, detectFileKind } from '../../src/documents/DocumentParser';
import {
  EPUB_MAX_BYTES,
  EPUB_PAGE_MAX_CHARS,
  EPUB_PAGE_TARGET_CHARS,
  EpubError,
  extractBlocks,
  paginate,
  parseXml,
  readEpub,
  readEpubBlob,
  splitLongText,
} from '../../src/documents/EpubReader';
import { draftProblem } from '../../src/documents/ui/importDraft';
import { useSessionStore } from '../../src/state/session';
import { clearDb, settings } from './queueHarness';

const mocks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../../src/documents/ProcessingQueue', () => ({ processingQueue: { start: mocks.start } }));

const { analyzeFile, importFiles, ImportError } = await import('../../src/documents/ImportService');

const NBSP = String.fromCharCode(0xa0);
const SHY = String.fromCharCode(0xad);

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const xhtml = (body: string): string => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="fr">
<head><title>Livre</title><style>p { margin: 0; }</style><script>var x = "<p>script</p>";</script></head>
<body>${body}</body>
</html>`;

/** About 400 characters, ending with a full stop. */
const paragraph = (n: number): string =>
  `Paragraphe ${n}. ` + 'Le petit renard traverse la grande forêt pour retrouver ses amis qui l’attendent près de la rivière. '.repeat(4).trim();

const LONG_SENTENCES = Array.from({ length: 60 }, (_, i) => `La phrase ${i + 1} raconte que le petit renard traverse la grande forêt pour retrouver ses amis près de la rivière.`);
const LONG_PARAGRAPH = LONG_SENTENCES.join(' ');
const CHAPTER_1_PARAGRAPHS = Array.from({ length: 7 }, (_, i) => paragraph(i + 1));
const CONTINUATION = 'La suite du chapitre deux continue sans titre, dans un simple bloc de texte.';

const CHAPTER_1 = xhtml(`
  <section epub:type="chapter">
    <h1>Chapitre 1 :<br/> Le départ</h1>
    <p class="first">Il était une <em>fois</em>&nbsp;! Un joli pa${SHY}pillon&#160;« bleu ».<a epub:type="noteref" href="#n1">1</a></p>
    <figure><img src="../Images/renard.jpg" alt="Un renard"/><figcaption>  </figcaption></figure>
    ${CHAPTER_1_PARAGRAPHS.map((p) => `<p>${p}</p>`).join('\n    ')}
    <aside epub:type="footnote" id="n1"><p>Une note de bas de page.</p></aside>
  </section>`);

const CHAPTER_2 = xhtml(`<h2 class="titre">Chapitre 2</h2>\n<p>${LONG_PARAGRAPH}</p>`);
const CHAPTER_3 = xhtml(`<div class="suite">${CONTINUATION}</div>`);
const NOTES = xhtml('<h1>Notes</h1><p>Note cachée hors du fil de lecture.</p>');
const NAV = xhtml('<nav epub:type="toc"><h1>Table des matières</h1><ol><li><a href="chap1.xhtml">Chapitre 1</a></li></ol></nav>');

function opf(spine: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:1234</dc:identifier>
    <dc:title>Le Renard &amp; la Rivière</dc:title>
    <dc:creator id="a1">Camille Martin</dc:creator>
    <dc:language>fr</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c3" href="Text/suite%20deux.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="Text/chap2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="Text/chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="Text/notes.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="Images/renard.jpg" media-type="image/jpeg"/>
    <item id="css" href="Styles/style.css" media-type="text/css"/>
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`;
}

const DEFAULT_SPINE = '<itemref idref="nav"/><itemref idref="c1"/><itemref idref="notes" linear="no"/><itemref idref="c2"/><itemref idref="c3"/><itemref idref="img"/>';

function buildEpub(extra: Record<string, string> = {}, spine = DEFAULT_SPINE): Uint8Array<ArrayBuffer> {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER),
    'OEBPS/content.opf': strToU8(opf(spine)),
    'OEBPS/nav.xhtml': strToU8(NAV),
    'OEBPS/Text/chap1.xhtml': strToU8(CHAPTER_1),
    'OEBPS/Text/chap2.xhtml': strToU8(CHAPTER_2),
    'OEBPS/Text/suite deux.xhtml': strToU8(CHAPTER_3),
    'OEBPS/Text/notes.xhtml': strToU8(NOTES),
    'OEBPS/Images/renard.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    'OEBPS/Styles/style.css': strToU8('p { color: black; }'),
  };
  for (const [path, content] of Object.entries(extra)) files[path] = strToU8(content);
  return zipSync(files);
}

const texts = (blocks: readonly TextBlock[]): string[] => blocks.map((b) => b.text);
const size = (blocks: readonly TextBlock[]): number => blocks.reduce((n, b) => n + b.text.length, 0);

function readError(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    return error instanceof EpubError ? error.code : 'other';
  }
  return null;
}

describe('EPUB text extraction', () => {
  it('turns XHTML into ordered titles and paragraphs, skipping notes, scripts, navigation and images', () => {
    const blocks = extractBlocks(parseXml(CHAPTER_1));
    expect(blocks[0]).toEqual({ kind: 'title', text: 'Chapitre 1 :\nLe départ' });
    expect(blocks[1]).toEqual({ kind: 'paragraph', text: `Il était une fois${NBSP}! Un joli papillon${NBSP}« bleu ».` });
    expect(texts(blocks.slice(2))).toEqual(CHAPTER_1_PARAGRAPHS);
    const all = texts(blocks).join(' ');
    expect(all).not.toContain('note de bas de page');
    expect(all).not.toContain('script');
    expect(all).not.toContain('Livre');
    expect(extractBlocks(parseXml(NAV))).toEqual([]);
  });

  it('reads nested blocks, lists, quotes, definitions and text-only divs', () => {
    const blocks = extractBlocks(parseXml(xhtml(`
      <div><h3>Un   titre</h3><div>Texte seul</div>
        <blockquote><p>Citation</p></blockquote>
        <ul><li>Premier</li><li>Deuxième <strong>mot</strong></li></ul>
        <dl><dt>Mot</dt><dd>Définition&hellip;</dd></dl>
        Texte libre<p>Fin&#x21;</p>
      </div>`)));
    expect(blocks).toEqual([
      { kind: 'title', text: 'Un titre' },
      { kind: 'paragraph', text: 'Texte seul' },
      { kind: 'paragraph', text: 'Citation' },
      { kind: 'paragraph', text: 'Premier' },
      { kind: 'paragraph', text: 'Deuxième mot' },
      { kind: 'paragraph', text: 'Mot' },
      { kind: 'paragraph', text: 'Définition…' },
      { kind: 'paragraph', text: 'Texte libre' },
      { kind: 'paragraph', text: 'Fin!' },
    ]);
  });

  it('splits a very long paragraph at sentence boundaries', () => {
    expect(LONG_PARAGRAPH.length).toBeGreaterThan(EPUB_PAGE_MAX_CHARS);
    const pieces = splitLongText(LONG_PARAGRAPH);
    expect(pieces.length).toBeGreaterThan(2);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(EPUB_PAGE_MAX_CHARS);
      expect(piece).toMatch(/^La phrase \d+ .*rivière\.$/);
    }
    expect(pieces.join(' ')).toBe(LONG_PARAGRAPH);
    expect(splitLongText('Court.')).toEqual(['Court.']);
    // One endless sentence: cut between words.
    const words = 'mot '.repeat(1500).trim();
    const cut = splitLongText(words);
    expect(cut.every((p) => p.length <= EPUB_PAGE_MAX_CHARS && !p.startsWith(' ') && !p.endsWith(' '))).toBe(true);
    expect(cut.join(' ')).toBe(words);
  });
});

describe('EPUB pagination', () => {
  const para = (n: number, length = 500): TextBlock => ({ kind: 'paragraph', text: `${n}`.padEnd(length, 'x') });
  const title = (text: string): TextBlock => ({ kind: 'title', text });

  it('fills pages of about the target size, cutting only between blocks', () => {
    const blocks = Array.from({ length: 10 }, (_, i) => para(i));
    const pages = paginate([blocks]);
    expect(pages.flat()).toEqual(blocks);
    for (const page of pages) expect(size(page)).toBeLessThanOrEqual(EPUB_PAGE_MAX_CHARS);
    expect(pages.slice(0, -1).every((page) => Math.abs(size(page) - EPUB_PAGE_TARGET_CHARS) <= 500)).toBe(true);
  });

  it('starts a chapter with a title on a new page and never ends a page with a title', () => {
    const pages = paginate([
      [title('Un'), para(1, 300)],
      [para(2, 300)],
      [title('Deux'), para(3, 1400), title('Deux bis'), para(4, 900)],
    ]);
    expect(pages.map(texts)).toEqual([
      ['Un', para(1, 300).text, para(2, 300).text],
      ['Deux', para(3, 1400).text],
      ['Deux bis', para(4, 900).text],
    ]);
  });

  it('refuses too many pages', () => {
    const chapters = Array.from({ length: 5 }, (_, i) => [title(`Chapitre ${i}`), para(i)]);
    expect(readError(() => paginate(chapters, 4))).toBe('too_many_pages');
    expect(paginate(chapters, 5)).toHaveLength(5);
  });
});

describe('readEpub', () => {
  it('reads metadata and follows the spine, skipping non-linear items', () => {
    const book = readEpub(buildEpub());
    expect(book.title).toBe('Le Renard & la Rivière');
    expect(book.author).toBe('Camille Martin');

    const flat = book.pages.flat();
    expect(flat[0]).toEqual({ kind: 'title', text: 'Chapitre 1 :\nLe départ' });
    const all = texts(flat).join('\n');
    expect(all).not.toContain('Note cachée');
    expect(all).not.toContain('Table des matières');
    expect(all.indexOf('Paragraphe 7.')).toBeLessThan(all.indexOf('Chapitre 2'));
    expect(all.indexOf('La phrase 60 ')).toBeLessThan(all.indexOf(CONTINUATION));

    // Chapter 2 has a title: it starts a page. Chapter 3 has none: it continues the current page.
    const chapter2 = book.pages.findIndex((page) => page[0]?.text === 'Chapitre 2');
    expect(chapter2).toBeGreaterThan(0);
    expect(book.pages[chapter2 - 1]!.at(-1)!.text).toBe(CHAPTER_1_PARAGRAPHS.at(-1));
    const last = book.pages.at(-1)!;
    expect(last.at(-1)!.text).toBe(CONTINUATION);
    expect(last.at(-2)!.text.endsWith('La phrase 60 raconte que le petit renard traverse la grande forêt pour retrouver ses amis près de la rivière.')).toBe(true);

    for (const page of book.pages) {
      expect(page.at(-1)!.kind).toBe('paragraph');
      expect(size(page.filter((b) => b.kind === 'paragraph'))).toBeLessThanOrEqual(EPUB_PAGE_MAX_CHARS);
    }
    // The long paragraph was split at sentence boundaries and nothing was lost.
    const longPieces = flat.filter((b) => b.text.startsWith('La phrase '));
    expect(longPieces.length).toBeGreaterThan(2);
    expect(longPieces.map((b) => b.text).join(' ')).toBe(LONG_PARAGRAPH);
  });

  it('refuses protected books but accepts obfuscated fonts', () => {
    const encryption = (algorithm: string, uri: string): string => `<?xml version="1.0"?>
      <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
        <enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/>
          <enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData>
      </encryption>`;
    const drm = buildEpub({ 'META-INF/encryption.xml': encryption('http://www.w3.org/2001/04/xmlenc#aes128-cbc', 'OEBPS/Text/chap1.xhtml') });
    expect(readError(() => readEpub(drm))).toBe('epub_protected');
    expect(readError(() => readEpub(buildEpub({ 'META-INF/rights.xml': '<rights/>' })))).toBe('epub_protected');
    const fonts = buildEpub({ 'META-INF/encryption.xml': encryption('http://www.idpf.org/2008/embedding', 'OEBPS/Fonts/font.otf') });
    expect(readEpub(fonts).pages.length).toBeGreaterThan(0);
  });

  it('reports damaged or empty books as unreadable', () => {
    const epub = buildEpub();
    expect(readError(() => readEpub(epub.subarray(0, Math.floor(epub.length / 2))))).toBe('epub_unreadable');
    expect(readError(() => readEpub(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5])))).toBe('epub_unreadable');
    expect(readError(() => readEpub(strToU8('pas un zip')))).toBe('epub_unreadable');
    expect(readError(() => readEpub(zipSync({ 'readme.txt': strToU8('bonjour') })))).toBe('epub_unreadable');
    expect(readError(() => readEpub(buildEpub({}, '<itemref idref="img"/>')))).toBe('epub_unreadable');
  });

  it('checks the size before reading the file', async () => {
    const huge = { size: EPUB_MAX_BYTES + 1, arrayBuffer: () => Promise.reject(new Error('not read')) } as unknown as Blob;
    await expect(readEpubBlob(huge)).rejects.toMatchObject({ code: 'too_large' });
  });
});

describe('EPUB import', () => {
  beforeEach(async () => {
    await clearDb();
    mocks.start.mockClear();
    useSessionStore.setState({
      authStatus: {
        setupRequired: false, authenticated: true, parentUnlockedUntil: null, pinSet: true, pinLockedUntil: null, registrationOpen: false,
        parent: { id: 'parent-1', email: 'parent', displayName: 'Parent', createdAt: 1, isOwner: true },
      },
      parentSettings: settings({ privacy: { uploadOriginals: true } }),
    });
  });

  it('detects EPUB files even without a MIME type', () => {
    expect(detectFileKind({ type: '', name: 'Mon livre.EPUB' })).toBe('epub');
    expect(detectFileKind({ type: 'application/epub+zip', name: 'livre' })).toBe('epub');
    expect(detectFileKind({ type: 'application/zip', name: 'archive.zip' })).toBeNull();
  });

  it('saves every page ready at once, without processing jobs, with the book title', async () => {
    const epub = new File([buildEpub()], 'renard.epub', { type: '' });
    const analyzed = await analyzeFile(epub);
    const book = readEpub(buildEpub());
    expect(analyzed).toMatchObject({ kind: 'epub', pageCount: book.pages.length, title: 'Le Renard & la Rivière' });

    const id = await importFiles([epub], { title: '  ', childIds: ['c1', 'c1'] });
    const doc = await db.documents.get(id);
    expect(doc).toMatchObject({ kind: 'epub', status: 'ready', title: 'Le Renard & la Rivière', pageCount: book.pages.length, childIds: ['c1'] });
    // What the sync pushes must pass the server validation.
    expect(DocumentMetaSchema.safeParse(doc).success).toBe(true);

    const pages = await db.pages.where('documentId').equals(id).sortBy('pageIndex');
    expect(pages).toHaveLength(book.pages.length);
    for (const [index, page] of pages.entries()) {
      expect(PageContentSchema.safeParse(page).success).toBe(true);
      expect(page).toMatchObject({
        pageIndex: index, status: 'ready', textSource: 'epub-text', confidence: null, width: null, height: null, warnings: [],
      });
      expect(page.blocks).toEqual(book.pages[index]);
      expect(page.contentHash).toBe(await computeContentHash(book.pages[index]!));
    }
    expect(await db.jobs.count()).toBe(0);
    expect(mocks.start).not.toHaveBeenCalled();
    const files = await db.documentFiles.where('documentId').equals(id).toArray();
    expect(files.map((f) => [f.index, f.name, f.mime])).toEqual([[0, 'renard.epub', 'application/epub+zip']]);
    expect(await db.kv.get('pendingUploads')).toBeUndefined();

    const named = await importFiles([epub], { title: 'Lecture du soir', childIds: [] });
    expect((await db.documents.get(named))?.title).toBe('Lecture du soir');
  });

  it('refuses an EPUB mixed with other files, and protected books, before writing anything', async () => {
    const epub = new File([buildEpub()], 'renard.epub', { type: 'application/epub+zip' });
    const photo = new File(['photo'], 'page.jpg', { type: 'image/jpeg' });
    const error = await importFiles([photo, epub], { title: 'T', childIds: [] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ code: 'epub_must_be_alone', fileName: 'renard.epub' });

    const drm = new File([buildEpub({ 'META-INF/rights.xml': '<rights/>' })], 'drm.epub', { type: '' });
    await expect(importFiles([drm], { title: 'T', childIds: [] })).rejects.toMatchObject({ code: 'epub_protected', fileName: 'drm.epub' });
    const broken = new File(['pas un zip'], 'abime.epub', { type: '' });
    await expect(analyzeFile(broken)).rejects.toMatchObject({ code: 'epub_unreadable' });

    expect(await db.documents.count()).toBe(0);
    expect(await db.pages.count()).toBe(0);
    expect(await db.documentFiles.count()).toBe(0);
  });

  it('flags the mix in the import form', () => {
    expect(draftProblem('Livre', [{ kind: 'epub', pageCount: 3, error: null }])).toBeNull();
    expect(draftProblem('Livre', [{ kind: 'epub', pageCount: 3, error: null }, { kind: 'image', pageCount: 1, error: null }])).toBe('epub_must_be_alone');
  });
});
