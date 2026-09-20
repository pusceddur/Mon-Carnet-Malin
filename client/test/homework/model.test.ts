// « Mes devoirs » (§19.3): lists, « J'ai terminé », PDF of the completed pages.
import type { DocumentMeta } from '@aide/shared';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { homeworkFileName } from '../../src/features/homework/exportHomework';
import { formatDay, setHomeworkDone, splitHomework } from '../../src/features/homework/homework';
import { A4_LONG_SIDE_PT, buildImagePdf, pdfTextString, wrapText } from '../../src/features/homework/pdf';
import { isBookOfChild } from '../../src/features/library/books';

vi.mock('../../src/sync/SyncEngine', () => ({
  saveEntity: async (table: string, entity: unknown) => {
    const { db: localDb } = await import('../../src/db/localDb');
    await localDb.table(table).put(entity);
  },
}));

function doc(patch: Partial<DocumentMeta>): DocumentMeta {
  return {
    id: 'd', ownerParentId: 'p1', childIds: ['c1'], title: 'Fiche', kind: 'images', textMode: 'faithful', purpose: 'homework',
    homeworkDoneAt: null, sourceHash: 'h', pageCount: 1, status: 'ready', createdAt: 1, updatedAt: 1, deletedAt: null, ...patch,
  };
}

beforeEach(async () => {
  await db.open();
  await db.documents.clear();
});

afterAll(() => {
  db.close();
});

describe('homework lists (§19.3)', () => {
  it('splits the child’s sheets: to do newest first, done most recently finished first; books and other children apart', () => {
    const docs = [
      doc({ id: 'old', createdAt: 1 }),
      doc({ id: 'new', createdAt: 5 }),
      doc({ id: 'done-early', homeworkDoneAt: 10 }),
      doc({ id: 'done-late', homeworkDoneAt: 20 }),
      doc({ id: 'book', purpose: 'reading' }),
      doc({ id: 'other', childIds: ['c2'] }),
      doc({ id: 'deleted', deletedAt: 3 }),
    ];
    const { todo, done } = splitHomework(docs, 'c1');
    expect(todo.map((d) => d.id)).toEqual(['new', 'old']);
    expect(done.map((d) => d.id)).toEqual(['done-late', 'done-early']);
    // « Mes livres » keeps the books only.
    expect(docs.filter((d) => isBookOfChild(d, 'c1')).map((d) => d.id)).toEqual(['book']);
  });

  it('« J’ai terminé » and « Pas encore fini » are saved like the title; a copy without purpose is a book', async () => {
    await db.documents.put(doc({ id: 'd1', updatedAt: 100 }));
    await setHomeworkDone('d1', true, 50);
    expect(await db.documents.get('d1')).toMatchObject({ homeworkDoneAt: 50, updatedAt: 101 });
    await setHomeworkDone('d1', false, 500);
    expect(await db.documents.get('d1')).toMatchObject({ homeworkDoneAt: null, updatedAt: 500 });

    const { purpose: _unknown, ...older } = doc({ id: 'older' });
    expect(splitHomework([older as DocumentMeta], 'c1').todo).toEqual([]);
    expect(formatDay(Date.UTC(2026, 8, 19, 12))).toBe('19 septembre');
  });
});

describe('PDF of the completed sheet', () => {
  const decoder = new TextDecoder('latin1');

  it('one page per image with the image ratio; the cross-reference table points at every object', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const bytes = buildImagePdf([{ jpeg, width: 1000, height: 1400 }, { jpeg, width: 1400, height: 1000 }], 'Fiche de maths – élève');
    const text = decoder.decode(bytes);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain(`/MediaBox [0 0 ${Math.round((1000 * A4_LONG_SIDE_PT) / 1400 * 100) / 100} ${A4_LONG_SIDE_PT}]`);
    expect(text).toContain(`/MediaBox [0 0 ${A4_LONG_SIDE_PT} ${Math.round((1000 * A4_LONG_SIDE_PT) / 1400 * 100) / 100}]`);
    expect(text).toContain('/Filter /DCTDecode /Length 9');
    expect(text).toContain(`/Title ${pdfTextString('Fiche de maths – élève')}`);

    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = text.slice(startxref).split('\n').filter((l) => /^\d{10} 00000 n $/.test(l));
    expect(entries).toHaveLength(9);
    entries.forEach((entry, i) => expect(text.slice(Number(entry.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true));
    expect(() => buildImagePdf([])).toThrow();
  });

  it('text strings are UTF-16 with a byte order mark; lines wrap on spaces and long words are cut', () => {
    expect(pdfTextString('Là')).toBe('<FEFF004C00E0>');
    const measure = (s: string): number => s.length * 10;
    expect(wrapText('le chat dort sur le tapis', 80, measure)).toEqual(['le chat', 'dort sur', 'le tapis']);
    expect(wrapText('anticonstitutionnellement', 80, measure)).toEqual(['anticons', 'titution', 'nellemen', 't']);
    expect(wrapText('Nom :\n\nMaths', 200, measure)).toEqual(['Nom :', '', 'Maths']);
  });

  it('file names keep the title without characters refused by file systems', () => {
    expect(homeworkFileName('Fiche 3/4 : les fractions?')).toBe('Fiche 3 4 les fractions.pdf');
    expect(homeworkFileName('   ')).toBe('Devoir.pdf');
  });
});
