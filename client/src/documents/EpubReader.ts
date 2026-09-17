// EPUB reading without the DOM: zip → container.xml → OPF (metadata, manifest, spine) → XHTML text blocks → logical pages.
import { normalizeDisplayText, segmentSentences, type TextBlock } from '@aide/shared';
import { unzipSync, type Unzipped } from 'fflate';

/** Usual size of a logical page (characters). */
export const EPUB_PAGE_TARGET_CHARS = 1800;
/** A page never grows beyond this by adding a block; longer paragraphs are split at sentence boundaries. */
export const EPUB_PAGE_MAX_CHARS = 2500;
export const EPUB_PAGE_MAX_BLOCKS = 120;
export const EPUB_MAX_BYTES = 150 * 1024 * 1024;
export const EPUB_MAX_PAGES = 500;
/** Guard against zip bombs: one text entry above this is refused. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export type EpubErrorCode = 'epub_protected' | 'epub_unreadable' | 'too_large' | 'too_many_pages';

export class EpubError extends Error {
  readonly code: EpubErrorCode;

  constructor(code: EpubErrorCode) {
    super(code);
    this.name = 'EpubError';
    this.code = code;
  }
}

export interface EpubBook {
  title: string | null;
  author: string | null;
  pages: TextBlock[][];
}

// ---------- tolerant XML / XHTML parsing ----------

export interface XmlElement {
  /** Local name, lowercased (« dc:title » → « title »). */
  name: string;
  /** Attribute names lowercased, prefix kept (« epub:type »). */
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

// HTML Latin-1 entity names, code points 160..255 in order.
const LATIN1_ENTITIES = (
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para ' +
  'middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute ' +
  'Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute ' +
  'THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ' +
  'ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
).split(' ');

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map<string, string>([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"],
  ...LATIN1_ENTITIES.map((name, i): [string, string] => [name, String.fromCodePoint(160 + i)]),
  ...([
    ['OElig', 338], ['oelig', 339], ['Scaron', 352], ['scaron', 353], ['Yuml', 376], ['fnof', 402], ['circ', 710], ['tilde', 732],
    ['ensp', 8194], ['emsp', 8195], ['thinsp', 8201], ['zwnj', 8204], ['zwj', 8205], ['lrm', 8206], ['rlm', 8207],
    ['ndash', 8211], ['mdash', 8212], ['lsquo', 8216], ['rsquo', 8217], ['sbquo', 8218], ['ldquo', 8220], ['rdquo', 8221],
    ['bdquo', 8222], ['dagger', 8224], ['Dagger', 8225], ['bull', 8226], ['hellip', 8230], ['permil', 8240], ['prime', 8242],
    ['Prime', 8243], ['lsaquo', 8249], ['rsaquo', 8250], ['euro', 8364], ['trade', 8482], ['minus', 8722],
  ] as const).map(([name, code]): [string, string] => [name, String.fromCodePoint(code)]),
]);

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : '';
    }
    return NAMED_ENTITIES.get(body) ?? match;
  });
}

const localName = (qualified: string): string => {
  const colon = qualified.indexOf(':');
  return (colon < 0 ? qualified : qualified.slice(colon + 1)).toLowerCase();
};

const isNameChar = (c: string): boolean => c !== '' && !/[\s/>=]/.test(c);

interface StartTag { name: string; attrs: Record<string, string>; selfClosing: boolean; end: number }

/** Reads `<name attr="v" …>` at `start` (which points at « < »). Null when this is not a tag. */
function readStartTag(source: string, start: number): StartTag | null {
  let i = start + 1;
  if (!/[A-Za-z_]/.test(source.charAt(i))) return null;
  const nameStart = i;
  while (i < source.length && isNameChar(source.charAt(i))) i++;
  const name = source.slice(nameStart, i);
  const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
  for (;;) {
    while (i < source.length && /\s/.test(source.charAt(i))) i++;
    const c = source.charAt(i);
    if (c === '') return null;
    if (c === '>') return { name, attrs, selfClosing: false, end: i + 1 };
    if (c === '/') {
      i++;
      if (source.charAt(i) === '>') return { name, attrs, selfClosing: true, end: i + 1 };
      continue;
    }
    const attrStart = i;
    while (i < source.length && isNameChar(source.charAt(i))) i++;
    if (i === attrStart) {
      // Stray « = »: skip it.
      i++;
      continue;
    }
    const attrName = source.slice(attrStart, i).toLowerCase();
    let value = '';
    let j = i;
    while (j < source.length && /\s/.test(source.charAt(j))) j++;
    if (source.charAt(j) === '=') {
      j++;
      while (j < source.length && /\s/.test(source.charAt(j))) j++;
      const quote = source.charAt(j);
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, j + 1);
        if (close < 0) return null;
        value = source.slice(j + 1, close);
        i = close + 1;
      } else {
        const valueStart = j;
        while (j < source.length && !/[\s>]/.test(source.charAt(j))) j++;
        value = source.slice(valueStart, j);
        i = j;
      }
    }
    attrs[attrName] = decodeEntities(value);
  }
}

function skipTo(source: string, from: number, marker: string): number {
  const at = source.indexOf(marker, from);
  return at < 0 ? source.length : at + marker.length;
}

/** Skips `<!DOCTYPE …>` including an internal subset `[ … ]`. */
function skipDeclaration(source: string, start: number): number {
  let depth = 0;
  for (let i = start + 2; i < source.length; i++) {
    const c = source.charAt(i);
    if (c === '[') depth++;
    else if (c === ']') depth = Math.max(0, depth - 1);
    else if (c === '>' && depth === 0) return i + 1;
  }
  return source.length;
}

/** Forgiving XML / XHTML parser: unknown entities kept, unclosed tags closed, void HTML elements accepted. */
export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const pushText = (text: string): void => {
    if (text.length > 0) stack[stack.length - 1]!.children.push(decodeEntities(text));
  };
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt < 0) {
      pushText(source.slice(i));
      break;
    }
    pushText(source.slice(i, lt));
    if (source.startsWith('<!--', lt)) {
      i = skipTo(source, lt + 4, '-->');
    } else if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      stack[stack.length - 1]!.children.push(source.slice(lt + 9, end < 0 ? source.length : end));
      i = end < 0 ? source.length : end + 3;
    } else if (source.startsWith('<?', lt)) {
      i = skipTo(source, lt + 2, '>');
    } else if (source.startsWith('<!', lt)) {
      i = skipDeclaration(source, lt);
    } else if (source.charAt(lt + 1) === '/') {
      const end = source.indexOf('>', lt + 2);
      const name = localName(source.slice(lt + 2, end < 0 ? source.length : end).trim());
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth]!.name === name) {
          stack.length = depth;
          break;
        }
      }
      i = end < 0 ? source.length : end + 1;
    } else {
      const tag = readStartTag(source, lt);
      if (!tag) {
        pushText('<');
        i = lt + 1;
        continue;
      }
      const element: XmlElement = { name: localName(tag.name), attrs: tag.attrs, children: [] };
      stack[stack.length - 1]!.children.push(element);
      i = tag.end;
      if (tag.selfClosing || VOID_ELEMENTS.has(element.name)) continue;
      if (RAW_TEXT_ELEMENTS.has(element.name)) {
        const close = new RegExp(`</${element.name}\\s*>`, 'gi');
        close.lastIndex = i;
        const match = close.exec(source);
        i = match ? match.index + match[0].length : source.length;
        continue;
      }
      stack.push(element);
    }
  }
  return root;
}

export function* elements(node: XmlElement, name?: string): Generator<XmlElement> {
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    if (name === undefined || child.name === name) yield child;
    yield* elements(child, name);
  }
}

function firstElement(node: XmlElement, name: string): XmlElement | null {
  for (const element of elements(node, name)) return element;
  return null;
}

/** Attribute by local name (« full-path », « opf:role » / « role »). */
function attr(element: XmlElement, name: string): string | null {
  if (name in element.attrs) return element.attrs[name]!;
  for (const [key, value] of Object.entries(element.attrs)) if (localName(key) === name) return value;
  return null;
}

export function textContent(node: XmlNode): string {
  return typeof node === 'string' ? node : node.children.map(textContent).join('');
}

// ---------- text blocks ----------

const TITLE_ELEMENTS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BLOCK_ELEMENTS = new Set([
  'html', 'body', 'p', 'li', 'blockquote', 'dd', 'dt', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'figure',
  'figcaption', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'ul', 'ol', 'dl', 'hr', 'address',
  'center', 'details', 'summary', 'hgroup',
]);
const SKIPPED_ELEMENTS = new Set([
  'head', 'script', 'style', 'nav', 'img', 'image', 'svg', 'math', 'audio', 'video', 'object', 'iframe', 'canvas', 'picture',
  'template', 'noscript', 'rt', 'rp', 'button', 'input', 'select', 'textarea', 'map',
]);
// epub:type / role values of footnotes, note references and printed page numbers.
const SKIPPED_SEMANTICS = new Set([
  'footnote', 'footnotes', 'endnote', 'endnotes', 'rearnote', 'rearnotes', 'noteref', 'pagebreak',
  'doc-footnote', 'doc-endnote', 'doc-endnotes', 'doc-noteref', 'doc-pagebreak',
]);
const LINE_BREAK = '\u2028';

function isSkipped(element: XmlElement): boolean {
  if (SKIPPED_ELEMENTS.has(element.name) || 'hidden' in element.attrs) return true;
  const semantics = `${element.attrs['epub:type'] ?? ''} ${element.attrs.role ?? ''}`.toLowerCase().split(/\s+/);
  return semantics.some((s) => SKIPPED_SEMANTICS.has(s));
}

/** XML whitespace collapsed, `<br>` kept as a line break, then the display normalization (soft hyphens, NFC, …). */
export function cleanInlineText(raw: string): string {
  const collapsed = raw.replace(/[ \t\r\n\f]+/g, ' ').replace(/ ?\u2028 ?/g, '\n');
  return normalizeDisplayText(collapsed);
}

/** Titles (h1–h6) and paragraphs of an XHTML document, in reading order. */
export function extractBlocks(document: XmlElement): TextBlock[] {
  const blocks: TextBlock[] = [];
  let buffer = '';
  let kind: TextBlock['kind'] = 'paragraph';
  const flush = (): void => {
    const text = cleanInlineText(buffer);
    buffer = '';
    if (text.length > 0) blocks.push({ kind, text });
  };
  const walk = (node: XmlNode): void => {
    if (typeof node === 'string') {
      buffer += node;
      return;
    }
    if (isSkipped(node)) return;
    if (node.name === 'br') {
      buffer += LINE_BREAK;
      return;
    }
    const title = TITLE_ELEMENTS.has(node.name);
    if (!title && !BLOCK_ELEMENTS.has(node.name)) {
      node.children.forEach(walk);
      return;
    }
    flush();
    const outer = kind;
    if (title) kind = 'title';
    node.children.forEach(walk);
    flush();
    kind = outer;
  };
  walk(firstElement(document, 'body') ?? document);
  flush();
  return blocks;
}

// ---------- pagination ----------

function wordRanges(text: string, start: number, end: number, limit: number): [number, number][] {
  const ranges: [number, number][] = [];
  let s = start;
  while (s < end) {
    while (s < end && /\s/.test(text.charAt(s))) s++;
    if (s >= end) break;
    if (end - s <= limit) {
      ranges.push([s, end]);
      break;
    }
    let cut = text.lastIndexOf(' ', s + limit);
    if (cut <= s) {
      cut = s + limit;
      if (/[\uDC00-\uDFFF]/.test(text.charAt(cut))) cut--;
    }
    ranges.push([s, cut]);
    s = cut;
  }
  return ranges;
}

/** Splits a text longer than `max` at sentence boundaries into pieces of about `target` characters (never above `max`). */
export function splitLongText(text: string, target = EPUB_PAGE_TARGET_CHARS, max = EPUB_PAGE_MAX_CHARS): string[] {
  if (text.length <= max) return [text];
  const units: [number, number][] = [];
  for (const span of segmentSentences(text)) {
    if (span.end - span.start > max) units.push(...wordRanges(text, span.start, span.end, target));
    else units.push([span.start, span.end]);
  }
  const pieces: string[] = [];
  let chunk: [number, number] | null = null;
  for (const [start, end] of units) {
    if (chunk && end - chunk[0] <= target) {
      chunk[1] = end;
      continue;
    }
    if (chunk) pieces.push(text.slice(chunk[0], chunk[1]).trim());
    chunk = [start, end];
  }
  if (chunk) pieces.push(text.slice(chunk[0], chunk[1]).trim());
  return pieces.filter((p) => p.length > 0);
}

/**
 * Groups chapters (one per spine document) into logical pages of about EPUB_PAGE_TARGET_CHARS characters, cutting
 * only between blocks. A chapter that has a title starts a new page; a page never ends with a title.
 */
export function paginate(chapters: Iterable<readonly TextBlock[]>, maxPages = EPUB_MAX_PAGES): TextBlock[][] {
  const pages: TextBlock[][] = [];
  let current: TextBlock[] = [];
  let size = 0;

  const closePage = (keepTitleWithNext: boolean): void => {
    const carried: TextBlock[] = [];
    if (keepTitleWithNext) {
      while (current.length > 1 && current[current.length - 1]!.kind === 'title') carried.unshift(current.pop()!);
    }
    if (current.length > 0) {
      pages.push(current);
      if (pages.length > maxPages) throw new EpubError('too_many_pages');
    }
    current = carried;
    size = carried.reduce((sum, b) => sum + b.text.length, 0);
  };

  const breakBefore = (length: number): boolean => {
    if (!current.some((b) => b.kind === 'paragraph')) return false;
    if (current.length >= EPUB_PAGE_MAX_BLOCKS) return true;
    const total = size + length;
    if (total > EPUB_PAGE_MAX_CHARS) return true;
    if (total <= EPUB_PAGE_TARGET_CHARS) return false;
    return Math.abs(total - EPUB_PAGE_TARGET_CHARS) >= Math.abs(size - EPUB_PAGE_TARGET_CHARS);
  };

  for (const chapter of chapters) {
    const blocks = chapter.flatMap((block) => splitLongText(block.text).map((text) => ({ kind: block.kind, text })));
    if (blocks.length === 0) continue;
    if (blocks.some((b) => b.kind === 'title')) closePage(false);
    for (const block of blocks) {
      if (current.length > 0 && breakBefore(block.text.length)) closePage(true);
      current.push(block);
      size += block.text.length;
    }
  }
  closePage(false);
  return pages;
}

// ---------- package ----------

const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#rc']);
const DRM_FILES = ['meta-inf/rights.xml', 'meta-inf/license.lcpl', 'meta-inf/sinf.xml'];
const CONTENT_TYPES = new Set(['application/xhtml+xml', 'text/html', 'application/xml', 'text/xml']);

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  const head = String.fromCharCode(...bytes.subarray(0, 200));
  const declared = /^\s*<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1];
  if (declared && !/^utf-?8$/i.test(declared)) {
    try {
      return new TextDecoder(declared).decode(bytes);
    } catch {
      // Unknown label: read as UTF-8.
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** Zip path of `href` (relative to `baseDir`, URL-encoded, maybe with a fragment). */
export function resolveHref(baseDir: string, href: string): string {
  let path = href.split('#')[0]!.split('?')[0]!;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path.
  }
  const parts = [...(path.startsWith('/') ? [] : baseDir.split('/')), ...path.split('/')];
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

const dirname = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
};

class ZipArchive {
  private readonly data: Uint8Array;
  private readonly names = new Map<string, string>();

  constructor(data: Uint8Array) {
    this.data = data;
    this.extract((name) => {
      this.names.set(name.toLowerCase(), name);
      return false;
    });
    if (this.names.size === 0) throw new EpubError('epub_unreadable');
  }

  /** Exact entry name, matched case-insensitively. */
  find(path: string): string | null {
    return this.names.get(path.toLowerCase()) ?? null;
  }

  entryNames(): string[] {
    return [...this.names.values()];
  }

  read(paths: readonly string[]): Unzipped {
    const wanted = new Set(paths);
    return this.extract((name) => wanted.has(name));
  }

  private extract(accept: (name: string) => boolean): Unzipped {
    try {
      return unzipSync(this.data, {
        filter: (info) => {
          if (!accept(info.name)) return false;
          if (info.originalSize > MAX_ENTRY_BYTES) throw new EpubError('too_large');
          return true;
        },
      });
    } catch (error) {
      if (error instanceof EpubError) throw error;
      throw new EpubError('epub_unreadable');
    }
  }
}

function checkProtection(zip: ZipArchive, encryptionXml: Uint8Array | undefined): void {
  if (DRM_FILES.some((path) => zip.find(path) !== null)) throw new EpubError('epub_protected');
  if (!encryptionXml) return;
  for (const data of elements(parseXml(decodeText(encryptionXml)), 'encrypteddata')) {
    const method = firstElement(data, 'encryptionmethod');
    const algorithm = method ? (attr(method, 'algorithm') ?? '').trim().toLowerCase() : '';
    // Font obfuscation is not DRM: the text stays readable.
    if (!FONT_OBFUSCATION.has(algorithm)) throw new EpubError('epub_protected');
  }
}

function metadataText(opf: XmlElement, name: string): string | null {
  const metadata = firstElement(opf, 'metadata') ?? opf;
  for (const element of elements(metadata, name)) {
    const text = cleanInlineText(textContent(element));
    if (text.length > 0) return text;
  }
  return null;
}

interface PackageInfo { title: string | null; author: string | null; contentPaths: string[] }

function readPackage(zip: ZipArchive, opfPath: string, opfBytes: Uint8Array): PackageInfo {
  const opf = parseXml(decodeText(opfBytes));
  const baseDir = dirname(opfPath);
  const manifest = new Map<string, { path: string; mediaType: string }>();
  for (const item of elements(opf, 'item')) {
    const id = attr(item, 'id');
    const href = attr(item, 'href');
    if (id && href) manifest.set(id, { path: resolveHref(baseDir, href), mediaType: (attr(item, 'media-type') ?? '').toLowerCase() });
  }
  const contentPaths: string[] = [];
  for (const itemref of elements(opf, 'itemref')) {
    if ((attr(itemref, 'linear') ?? '').trim().toLowerCase() === 'no') continue;
    const item = manifest.get(attr(itemref, 'idref') ?? '');
    if (!item) continue;
    const isContent = item.mediaType ? CONTENT_TYPES.has(item.mediaType) : /\.x?html?$/i.test(item.path);
    const name = isContent ? zip.find(item.path) : null;
    if (name && !contentPaths.includes(name)) contentPaths.push(name);
  }
  const title = metadataText(opf, 'title');
  return { title: title ? title.replace(/\n/g, ' ').slice(0, 200) : null, author: metadataText(opf, 'creator'), contentPaths };
}

/** Reads an EPUB file. Throws EpubError. */
export function readEpub(data: Uint8Array): EpubBook {
  if (data.byteLength > EPUB_MAX_BYTES) throw new EpubError('too_large');
  const zip = new ZipArchive(data);

  const containerName = zip.find('META-INF/container.xml');
  const encryptionName = zip.find('META-INF/encryption.xml');
  const meta = zip.read([containerName, encryptionName].filter((n): n is string => n !== null));
  checkProtection(zip, encryptionName ? meta[encryptionName] : undefined);

  let opfName: string | null = null;
  const container = containerName ? meta[containerName] : undefined;
  if (container) {
    for (const rootfile of elements(parseXml(decodeText(container)), 'rootfile')) {
      const fullPath = attr(rootfile, 'full-path');
      opfName = fullPath ? zip.find(resolveHref('', fullPath)) : null;
      if (opfName) break;
    }
  }
  opfName ??= zip.entryNames().find((name) => /\.opf$/i.test(name)) ?? null;
  const opfBytes = opfName ? zip.read([opfName])[opfName] : undefined;
  if (!opfName || !opfBytes) throw new EpubError('epub_unreadable');

  const info = readPackage(zip, opfName, opfBytes);
  if (info.contentPaths.length === 0) throw new EpubError('epub_unreadable');
  const contents = zip.read(info.contentPaths);
  const chapters = function* (): Generator<TextBlock[]> {
    for (const path of info.contentPaths) {
      const bytes = contents[path];
      if (bytes) yield extractBlocks(parseXml(decodeText(bytes)));
    }
  };
  const pages = paginate(chapters());
  if (pages.length === 0) throw new EpubError('epub_unreadable');
  return { title: info.title, author: info.author, pages };
}

/** Reads an EPUB Blob (size checked before loading it in memory). */
export async function readEpubBlob(blob: Blob): Promise<EpubBook> {
  if (blob.size > EPUB_MAX_BYTES) throw new EpubError('too_large');
  let buffer: ArrayBuffer;
  try {
    buffer = await blob.arrayBuffer();
  } catch {
    throw new EpubError('epub_unreadable');
  }
  return readEpub(new Uint8Array(buffer));
}
