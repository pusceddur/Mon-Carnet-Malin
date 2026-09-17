import { describe, expect, it } from 'vitest';
import {
  countLetters,
  detectFileKind,
  hasUsablePdfText,
  isDoubtfulPage,
  isHeic,
  MIN_PDF_TEXT_LETTERS,
  pendingPage,
  titleFromFileName,
} from '../../src/documents/DocumentParser';
import { deriveDocumentStatus, toQueueJob } from '../../src/documents/DocumentCache';
import { textItemsToLines, type PdfTextItemLike } from '../../src/documents/PDFReader';

// A4 page at scale 1: viewport.transform = [1, 0, 0, -1, 0, 842].
const VIEWPORT = [1, 0, 0, -1, 0, 842];

/** Text item at (x, baseline y from the top) with a font size, as pdf.js reports it (PDF user space, y up). */
function item(str: string, x: number, yTop: number, size: number, width: number, hasEOL = false): PdfTextItemLike {
  return { str, transform: [size, 0, 0, size, x, 842 - yTop], width, height: size, hasEOL };
}

describe('textItemsToLines', () => {
  it('joins items of a line, adds missing spaces and converts to top-left coordinates', () => {
    const lines = textItemsToLines(
      [
        item('La photo', 72, 100, 12, 48),
        item('synthèse', 121, 100, 12, 50), // touching: no space
        item('est', 176, 100, 12, 18, true), // gap: space
        item('importante.', 72, 116, 12, 60),
      ],
      VIEWPORT,
    );
    expect(lines).toEqual([
      { text: 'La photosynthèse est', top: 88, height: 12, left: 72, fontSize: 12 },
      { text: 'importante.', top: 104, height: 12, left: 72, fontSize: 12 },
    ]);
  });

  it('keeps titles apart through the font size', () => {
    const lines = textItemsToLines([item('Chapitre 2', 72, 80, 24, 120, true), item('Les volcans', 72, 110, 12, 70)], VIEWPORT);
    expect(lines.map((l) => [l.text, l.fontSize])).toEqual([
      ['Chapitre 2', 24],
      ['Les volcans', 12],
    ]);
  });

  it('keeps two columns apart (content-stream order, gutter detection)', () => {
    const lines = textItemsToLines(
      [
        item('Colonne un,', 72, 100, 10, 60),
        item('ligne une.', 72, 114, 10, 50),
        item('Colonne deux,', 320, 100, 10, 70),
        item('ligne une.', 320, 114, 10, 50),
      ],
      VIEWPORT,
    );
    expect(lines.map((l) => l.text)).toEqual(['Colonne un,', 'ligne une.', 'Colonne deux,', 'ligne une.']);
    // A wide gap on the same baseline is a gutter, not a space.
    const sameBaseline = textItemsToLines([item('Gauche', 72, 100, 10, 30), item('Droite', 320, 100, 10, 30)], VIEWPORT);
    expect(sameBaseline.map((l) => l.text)).toEqual(['Gauche', 'Droite']);
  });

  it('ignores blank items and uses explicit end-of-line markers', () => {
    const lines = textItemsToLines(
      [item(' ', 72, 90, 12, 3, true), item('Bonjour', 72, 100, 12, 40), item('', 112, 100, 12, 0, true), item('à tous', 72, 100.5, 12, 36)],
      VIEWPORT,
    );
    expect(lines.map((l) => l.text)).toEqual(['Bonjour', 'à tous']);
  });

  it('handles a scaled viewport', () => {
    const lines = textItemsToLines([item('Texte', 10, 20, 10, 25)], [2, 0, 0, -2, 0, 1684]);
    expect(lines[0]).toMatchObject({ left: 20, top: 20, height: 20 });
  });
});

describe('DocumentParser helpers', () => {
  it('uses the PDF text layer from 40 letters', () => {
    expect(MIN_PDF_TEXT_LETTERS).toBe(40);
    expect(countLetters('Élève 12, çà !')).toBe(7);
    const short = [{ text: 'Page 12 — 1789', top: 0, left: 0, height: 10 }];
    expect(hasUsablePdfText(short)).toBe(false);
    const enough = [{ text: 'a'.repeat(20), top: 0, left: 0, height: 10 }, { text: 'é'.repeat(20), top: 12, left: 0, height: 10 }];
    expect(hasUsablePdfText(enough)).toBe(true);
  });

  it('detects file kinds, HEIC and titles', () => {
    expect(detectFileKind({ type: 'application/pdf', name: 'x' })).toBe('pdf');
    expect(detectFileKind({ type: '', name: 'Cours.PDF' })).toBe('pdf');
    expect(detectFileKind({ type: 'image/heic', name: 'IMG_1.HEIC' })).toBe('image');
    expect(detectFileKind({ type: '', name: 'photo.heif' })).toBe('image');
    expect(detectFileKind({ type: 'text/plain', name: 'notes.txt' })).toBeNull();
    expect(isHeic({ type: '', name: 'IMG_2.heic' })).toBe(true);
    expect(isHeic({ type: 'image/jpeg', name: 'a.jpg' })).toBe(false);
    expect(titleFromFileName('Sciences_chapitre 3.pdf')).toBe('Sciences chapitre 3');
  });

  it('derives the document status and doubtful pages', () => {
    expect(deriveDocumentStatus([{ status: 'ready' }, { status: 'pending' }])).toBe('processing');
    expect(deriveDocumentStatus([{ status: 'ready' }, { status: 'low_confidence' }])).toBe('partial');
    expect(deriveDocumentStatus([{ status: 'ready' }, { status: 'failed' }])).toBe('partial');
    expect(deriveDocumentStatus([{ status: 'ready' }])).toBe('ready');
    const p = pendingPage('d', 0, 1);
    expect(isDoubtfulPage(p)).toBe(false);
    expect(isDoubtfulPage({ ...p, status: 'ready', warnings: ['no_text_found'] })).toBe(true);
    expect(isDoubtfulPage({ ...p, status: 'ready', warnings: ['manually_corrected'] })).toBe(false);
  });

  it('reads job records with missing or invalid queue fields', () => {
    const job = toQueueJob({ documentId: 'd', pageIndex: 2, state: 'queued', stage: 'weird', attempts: 1, error: null, updatedAt: 50 });
    expect(job).toMatchObject({ stage: 'initial', source: null, rotateDegrees: 0, quad: null, mode: 'auto', priority: 0, enqueuedAt: 50, notBefore: 0 });
    const withQuad = toQueueJob({
      documentId: 'd', pageIndex: 0, state: 'done', stage: 'reprocess', attempts: 0, error: null, updatedAt: 1,
      quad: [[0, 0], [1, 0], [1, 1]], rotateDegrees: 45,
    } as never);
    expect(withQuad.quad).toBeNull();
    expect(withQuad.rotateDegrees).toBe(0);
  });
});
