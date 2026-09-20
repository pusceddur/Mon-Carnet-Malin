import type { Answer, DocumentMeta, Exercise, InkAnnotation, PageContent, TextHighlight } from '@aide/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildNotes, pagesNeededForNotes } from '../../src/features/notes/notesModel';

const doc = (id: string, patch: Partial<DocumentMeta> = {}): DocumentMeta => ({
  id, ownerParentId: 'p1', childIds: ['c1'], title: `Livre ${id}`, kind: 'pdf', textMode: 'faithful', purpose: 'reading', homeworkDoneAt: null, sourceHash: 'x', pageCount: 5, status: 'ready',
  createdAt: 1, updatedAt: 1, deletedAt: null, ...patch,
});

const page = (documentId: string, pageIndex: number, patch: Partial<PageContent> = {}): PageContent => ({
  documentId, pageIndex, status: 'ready', textSource: 'pdf-text', blocks: [{ kind: 'paragraph', text: 'Le chat dort au soleil.' }],
  confidence: null, contentHash: 'h', width: null, height: null, warnings: [], updatedAt: 1, ...patch,
});

const highlight = (id: string, patch: Partial<TextHighlight> = {}): TextHighlight => ({
  id, type: 'highlight', childId: 'c1', documentId: 'd1', color: '#fde047', pageIndex: 0, blockIndex: 0, start: 3, end: 7,
  blockTextHash: 'b', text: 'chat', createdAt: 1, updatedAt: 1, deletedAt: null, ...patch,
});

const ink = (id: string, space: InkAnnotation['space'], patch: Partial<InkAnnotation> = {}): InkAnnotation => ({
  id, type: 'ink', childId: 'c1', documentId: 'd1', tool: 'pencil', color: '#1f2937', width: 0.1, opacity: 1, space,
  points: [{ x: 0, y: 0, p: 0.5 }], createdAt: 1, updatedAt: 1, deletedAt: null, ...patch,
});

const textSpace = (pageIndex: number, contextText = 'soleil'): InkAnnotation['space'] => ({
  kind: 'text', pageIndex, blockIndex: 0, charOffset: 17, blockTextHash: 'b', contextText, endAnchor: null,
} as InkAnnotation['space']);

const exercise: Exercise = {
  id: 'e1', childId: 'c1', documentId: 'd1', pageIndexes: [0], origin: 'local', createdAt: 1, updatedAt: 1, deletedAt: null,
  questions: [{ id: 'q1', type: 'reponse_libre', prompt: 'Où dort le chat ?', source: { pageIndex: 0, quote: 'Le chat dort' }, expectedAnswer: 'au soleil', keyPoints: [] }],
};

const answer = (id: string, text: string, updatedAt: number, patch: Partial<Answer> = {}): Answer => ({
  id, exerciseId: 'e1', questionId: 'q1', childId: 'c1', response: { type: 'reponse_libre', text }, inputMethod: 'clavier',
  inkAnnotationId: null, verdict: null, feedback: null, correctedBy: null, rereadRef: null, createdAt: 1, updatedAt, ...patch,
});

describe('notes model', () => {
  it('lists the pages needed to detect detached notes', () => {
    expect(pagesNeededForNotes([
      highlight('h1'),
      highlight('h2', { pageIndex: 2 }),
      highlight('h3'),
      ink('i1', textSpace(4)),
      ink('i2', { kind: 'original', pageIndex: 1 }),
      highlight('gone', { pageIndex: 3, deletedAt: 5 }),
    ])).toEqual([['d1', 0], ['d1', 2], ['d1', 4]]);
  });

  it('groups highlights, drawings, answers and detached notes by book', () => {
    const reanchor = vi.fn((anchor: { blockIndex: number }, p: PageContent) => (p.pageIndex === 2 ? ('orphan' as const) : { blockIndex: anchor.blockIndex, start: 0, end: 1 }));
    const groups = buildNotes({
      documents: [doc('d1', { updatedAt: 1 }), doc('d2', { deletedAt: 9 })],
      pages: [page('d1', 0), page('d1', 2), page('d1', 3, { status: 'processing' })],
      annotations: [
        highlight('h-late', { pageIndex: 0, start: 10, text: ' soleil ', updatedAt: 3 }),
        highlight('h-early', { pageIndex: 0, start: 3 }),
        highlight('h-detached', { pageIndex: 2, text: 'lune' }),
        highlight('h-processing', { pageIndex: 3, text: 'étoile' }),
        highlight('h-missing-page', { pageIndex: 4, text: 'nuage' }),
        ink('i-text', textSpace(0)),
        ink('i-detached', textSpace(2, 'mer')),
        ink('i-original', { kind: 'original', pageIndex: 1 }),
        ink('i-answer', { kind: 'answer', exerciseId: 'e1', questionId: 'q1' }, { documentId: 'd1' }),
        highlight('h-deleted', { deletedAt: 2 }),
        highlight('h-other-doc', { documentId: 'd2' }),
      ],
      exercises: [exercise],
      answers: [answer('a-old', 'à la maison', 2), answer('a-new', 'au soleil', 8)],
      reanchor,
    });

    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g?.title).toBe('Livre d1');
    expect(g?.highlights.map((h) => h.id)).toEqual(['h-early', 'h-late', 'h-processing', 'h-missing-page']);
    expect(g?.highlights[1]?.text).toBe('soleil');
    expect(g?.inkCount).toBe(2);
    expect(g?.firstPageIndex).toBe(0);
    expect(g?.detached).toEqual([
      { id: 'h-detached', kind: 'highlight', text: 'lune', pageIndex: 2 },
      { id: 'i-detached', kind: 'ink', text: 'mer', pageIndex: 2 },
    ]);
    expect(g?.answers).toEqual([{ id: 'a-new', exerciseId: 'e1', prompt: 'Où dort le chat ?', text: 'au soleil', drawn: false }]);
    expect(g?.lastActivityAt).toBe(8);
    // Pages still processing or absent are never checked.
    expect(reanchor.mock.calls.every(([, p]) => p.status === 'ready')).toBe(true);
  });

  it('keeps drawn answers and orders books by recent activity', () => {
    const groups = buildNotes({
      documents: [doc('d1'), doc('d9')],
      pages: [],
      annotations: [highlight('h9', { documentId: 'd9', updatedAt: 50 })],
      exercises: [exercise],
      answers: [answer('a-ink', '', 20, { inkAnnotationId: 'ink-1' })],
      reanchor: () => 'orphan',
    });
    expect(groups.map((g) => g.documentId)).toEqual(['d9', 'd1']);
    expect(groups[1]?.answers[0]).toMatchObject({ text: null, drawn: true });
    // No page available: not detached.
    expect(groups[0]?.highlights).toHaveLength(1);
  });
});
