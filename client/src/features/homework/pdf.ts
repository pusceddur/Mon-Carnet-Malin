// Minimal PDF of page images (§19.3 « Envoyer ou imprimer »): one JPEG (DCTDecode) per page, the page size keeps the image
// ratio with the long side of an A4 sheet. No dependency: the file is small, and printing apps fit it to the paper.

export interface PdfImagePage {
  /** Baseline RGB JPEG (as produced by a canvas). */
  jpeg: Uint8Array;
  width: number;
  height: number;
}

/** Long side of an A4 sheet in PDF points. */
export const A4_LONG_SIDE_PT = 841.89;

const encoder = new TextEncoder();

/** Text string in UTF-16BE with a byte order mark (accents of French titles), as a hex string. */
export function pdfTextString(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return `<${hex}>`;
}

const points = (value: number): string => (Math.round(value * 100) / 100).toString();

export function buildImagePdf(pages: readonly PdfImagePage[], title = ''): Uint8Array<ArrayBuffer> {
  if (pages.length === 0) throw new RangeError('no pages');
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string): void => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, ...body: (Uint8Array | string)[]): void => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    for (const part of body) push(part);
    push('\nendobj\n');
  };

  // Header, then a comment with bytes above 127 so that transfers treat the file as binary.
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // Objects: 1 catalog, 2 page tree, 3 info; page i: 4 + 3i page, 5 + 3i image, 6 + 3i content.
  const pageId = (i: number): number => 4 + 3 * i;
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  object(3, `<< /Title ${pdfTextString(title)} /Producer ${pdfTextString('Mon Carnet Malin')} >>`);
  pages.forEach((page, i) => {
    const scale = A4_LONG_SIDE_PT / Math.max(page.width, page.height);
    const w = points(page.width * scale);
    const h = points(page.height * scale);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    object(
      pageId(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${pageId(i) + 1} 0 R >> >> /Contents ${pageId(i) + 2} 0 R >>`,
    );
    object(
      pageId(i) + 1,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      page.jpeg,
      '\nendstream',
    );
    object(pageId(i) + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  const size = pageId(pages.length);
  const xref = length;
  push(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let id = 1; id < size; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * Lines of `text` that fit in `maxWidth` (greedy, on spaces; a word longer than the line is cut). Line breaks of the
 * text are kept, an empty line stays empty.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      let rest = word;
      while (measure(rest) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}
