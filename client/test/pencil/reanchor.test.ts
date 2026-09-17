import type { InkAnnotation, TextHighlight } from '@aide/shared';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import {
  blockTextHash,
  buildContextText,
  currentTextAnchor,
  isOrphanAnnotation,
  reanchor,
  reanchorAnnotation,
  reanchorPageAnnotations,
  type TextInkSpace,
} from '../../src/pencil/anchoring';
import { getOrphanAnnotations } from '../../src/pencil/AnnotationStore';
import { pageContent } from './helpers';

vi.mock('../../src/sync/SyncEngine', () => ({
  saveEntity: async (table: string, entity: unknown) => {
    const { db: localDb } = await import('../../src/db/localDb');
    await localDb.table(table).put(entity);
  },
}));

const DOC = 'doc-reanchor';
const CHILD = 'child-1';
const TEXT_A = 'La photosynthèse permet aux plantes de fabriquer leur nourriture. Elles utilisent la lumière du soleil.';
const TEXT_B = 'Les feuilles vertes captent la lumière.';

function highlight(text: string, blockText: string, blockIndex = 0, overrides: Partial<TextHighlight> = {}): TextHighlight {
  const start = blockText.indexOf(text);
  if (start === -1) throw new Error('text not in block');
  return {
    id: `hl-${text}`, type: 'highlight', childId: CHILD, documentId: DOC, color: '#fde047', pageIndex: 0, blockIndex,
    start, end: start + text.length, blockTextHash: blockTextHash(blockText), text,
    createdAt: 1, updatedAt: 1, deletedAt: null, ...overrides,
  };
}

function inkSpace(word: string, blockText: string, blockIndex = 0, endAnchor: TextInkSpace['endAnchor'] = null): TextInkSpace {
  const charOffset = blockText.indexOf(word);
  return { kind: 'text', pageIndex: 0, blockIndex, charOffset, blockTextHash: blockTextHash(blockText), contextText: buildContextText(blockText, charOffset), endAnchor };
}

function ink(id: string, space: TextInkSpace): InkAnnotation {
  return {
    id, type: 'ink', childId: CHILD, documentId: DOC, tool: 'pen', color: '#2563eb', width: 0.1, opacity: 1, space,
    points: [{ x: 0, y: 1.2, p: 0.5 }, { x: 3, y: 1.2, p: 0.5 }], createdAt: 1, updatedAt: 1, deletedAt: null,
  };
}

describe('reanchor (pure)', () => {
  it('keeps the position when the block hash is unchanged', () => {
    const h = highlight('aux plantes', TEXT_A);
    expect(reanchor(h, pageContent(DOC, 0, [TEXT_A, TEXT_B]))).toEqual({ blockIndex: 0, start: h.start, end: h.end });
  });

  it('shifts offsets when text is inserted before the highlight (same block)', () => {
    const h = highlight('aux plantes', TEXT_A);
    const edited = `Au printemps, ${TEXT_A}`;
    const r = reanchor(h, pageContent(DOC, 0, [edited, TEXT_B]));
    expect(r).toEqual({ blockIndex: 0, start: h.start + 14, end: h.end + 14 });
  });

  it('finds the text in another block when a paragraph is split (nearest block first)', () => {
    const h = highlight('la lumière du soleil.', TEXT_A);
    const [first, second] = ['La photosynthèse permet aux plantes de fabriquer leur nourriture.', 'Elles utilisent la lumière du soleil.'];
    const r = reanchor(h, pageContent(DOC, 0, [first!, second!, TEXT_B]));
    expect(r).toEqual({ blockIndex: 1, start: second!.indexOf('la lumière'), end: second!.length });
  });

  it('matches despite OCR corrections that only change accents, case or punctuation', () => {
    const h = highlight('fabriquer leur nourriture', TEXT_A);
    const corrected = TEXT_A.replace('fabriquer leur nourriture', 'FABRIQUER  leur nourriturE').replace('photosynthèse', 'photosynthese');
    const r = reanchor(h, pageContent(DOC, 0, [corrected, TEXT_B]));
    expect(r).not.toBe('orphan');
    if (r !== 'orphan') expect(corrected.slice(r.start, r.end)).toBe('FABRIQUER  leur nourriturE');
  });

  it('falls back to a fuzzy token match (Jaccard ≥ 0.8)', () => {
    const h = highlight('utilisent la lumière du soleil', TEXT_A);
    const edited = TEXT_A.replace('utilisent la lumière', 'utilisent bien la lumière');
    const r = reanchor(h, pageContent(DOC, 0, [edited, TEXT_B]));
    expect(r).not.toBe('orphan');
    if (r !== 'orphan') expect(edited.slice(r.start, r.end)).toBe('utilisent bien la lumière du soleil');
  });

  it('is orphan when the text is gone', () => {
    const h = highlight('fabriquer leur nourriture', TEXT_A);
    expect(reanchor(h, pageContent(DOC, 0, ['Un tout autre texte sur les volcans.', TEXT_B]))).toBe('orphan');
    expect(reanchor(h, pageContent(DOC, 0, []))).toBe('orphan');
  });

  it('re-anchors an ink stroke on its context and keeps the position inside the context', () => {
    const space = inkSpace('nourriture', TEXT_A);
    const edited = TEXT_A.replace('La photosynthèse', 'Grâce à la photosynthèse, cela');
    const r = reanchor(space, pageContent(DOC, 0, [edited]));
    expect(r).not.toBe('orphan');
    if (r !== 'orphan') expect(edited.slice(r.start).startsWith('nourriture')).toBe(true);
  });

  it('moves an end anchor with the old page, or keeps it when unambiguous', () => {
    const space = inkSpace('permet', TEXT_A, 0, { blockIndex: 1, charOffset: TEXT_B.indexOf('captent') });
    const a = ink('ink-multi', space);
    const inserted = 'Titre du chapitre';
    const moved = reanchorAnnotation(a, pageContent(DOC, 0, [TEXT_A, TEXT_B]), pageContent(DOC, 0, [inserted, TEXT_A, TEXT_B])) as InkAnnotation;
    expect(moved.space).toMatchObject({ blockIndex: 1, charOffset: TEXT_A.indexOf('permet'), endAnchor: { blockIndex: 2, charOffset: TEXT_B.indexOf('captent') } });
  });

  it('draws with a shifted anchor when the page changed without persisted re-anchoring', () => {
    const space = inkSpace('permet', TEXT_A, 0, { blockIndex: 0, charOffset: TEXT_A.indexOf('lumière') });
    const edited = `Oui. ${TEXT_A}`;
    expect(currentTextAnchor(space, pageContent(DOC, 0, [edited]))).toEqual({
      blockIndex: 0,
      charOffset: space.charOffset + 5,
      endAnchor: { blockIndex: 0, charOffset: TEXT_A.indexOf('lumière') + 5 },
    });
    expect(currentTextAnchor(space, pageContent(DOC, 0, ['Rien à voir.']))).toBeNull();
    expect(currentTextAnchor(space, undefined)).toMatchObject({ charOffset: space.charOffset });
  });
});

describe('reanchorPageAnnotations and orphans (Dexie)', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all([db.annotations.clear(), db.pages.clear()]);
  });

  afterAll(() => {
    db.close();
  });

  it('updates moved annotations through saveEntity before the new page is saved, leaves orphans untouched', async () => {
    const oldPage = pageContent(DOC, 0, [TEXT_A, TEXT_B]);
    await db.pages.put(oldPage);
    const moved = highlight('aux plantes', TEXT_A);
    const orphan = highlight('captent la lumière', TEXT_B, 1, { id: 'hl-orphan' });
    const unchanged = { ...highlight('La photosynthèse', TEXT_A), id: 'hl-unchanged' };
    const stroke = ink('ink-1', inkSpace('nourriture', TEXT_A));
    const otherPage = { ...highlight('aux plantes', TEXT_A), id: 'hl-page-2', pageIndex: 2 };
    await db.annotations.bulkPut([moved, orphan, unchanged, stroke, otherPage]);

    const newA = `Chapitre 3. ${TEXT_A}`;
    const newPage = pageContent(DOC, 0, [newA, 'Un texte corrigé sans rapport.']);
    await reanchorPageAnnotations(DOC, 0, newPage);

    const savedMoved = (await db.annotations.get(moved.id)) as TextHighlight;
    expect(savedMoved).toMatchObject({ blockIndex: 0, start: moved.start + 12, end: moved.end + 12, text: 'aux plantes', blockTextHash: blockTextHash(newA) });
    expect(savedMoved.updatedAt).toBeGreaterThan(moved.updatedAt);
    const savedInk = (await db.annotations.get(stroke.id)) as InkAnnotation;
    expect(savedInk.space).toMatchObject({ charOffset: newA.indexOf('nourriture'), blockTextHash: blockTextHash(newA) });
    expect(savedInk.points).toEqual(stroke.points);
    expect(await db.annotations.get(orphan.id)).toEqual(orphan);
    expect((await db.annotations.get(otherPage.id))?.updatedAt).toBe(1);
    // « La photosynthèse » moved too (prefix inserted): updated as well.
    expect((await db.annotations.get(unchanged.id)) as TextHighlight).toMatchObject({ start: 12 });

    await db.pages.put(newPage);
    const orphans = await getOrphanAnnotations(DOC, CHILD);
    expect(orphans.map((a) => a.id)).toEqual([orphan.id]);
    expect(isOrphanAnnotation(orphan, newPage)).toBe(true);
    expect(isOrphanAnnotation(orphan, pageContent(DOC, 0, []))).toBe(false); // no text: unknown, not orphan
  });

  it('uses the stored page when no new content is given', async () => {
    const h = highlight('aux plantes', TEXT_A);
    await db.annotations.put(h);
    const newA = `Bonjour. ${TEXT_A}`;
    await db.pages.put(pageContent(DOC, 0, [newA]));
    await reanchorPageAnnotations(DOC, 0);
    expect((await db.annotations.get(h.id)) as TextHighlight).toMatchObject({ start: h.start + 9, blockTextHash: blockTextHash(newA) });
    await expect(reanchorPageAnnotations(DOC, 5)).resolves.toBeUndefined();
  });
});
