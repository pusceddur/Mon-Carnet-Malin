import type {
  Annotation, Answer, DocumentMeta, Exercise, Id, InkAnnotation, Millis, PageContent, TextHighlight,
} from '@aide/shared';
import type { ReanchorResult, ReanchorSource } from '../../pencil/anchoring';

export interface NoteHighlight { id: Id; text: string; color: string; pageIndex: number }
export interface NoteAnswer { id: Id; exerciseId: Id; prompt: string; text: string | null; drawn: boolean }
export interface DetachedNote { id: Id; kind: 'highlight' | 'ink'; text: string; pageIndex: number }

export interface DocumentNotes {
  documentId: Id;
  title: string;
  /** First page carrying a note (to open the reader there). */
  firstPageIndex: number | null;
  highlights: NoteHighlight[];
  inkCount: number;
  answers: NoteAnswer[];
  detached: DetachedNote[];
  lastActivityAt: Millis;
}

export interface NotesInput {
  documents: readonly DocumentMeta[];
  pages: readonly PageContent[];
  /** The child's annotations (deleted ones are ignored). */
  annotations: readonly Annotation[];
  exercises: readonly Exercise[];
  answers: readonly Answer[];
  reanchor: (anchor: ReanchorSource, page: PageContent) => ReanchorResult;
}

const pageKey = (documentId: Id, pageIndex: number): string => `${documentId}:${pageIndex}`;

function textAnchorPage(a: Annotation): number | null {
  if (a.type === 'highlight') return a.pageIndex;
  if (a.type === 'ink' && a.space.kind === 'text') return a.space.pageIndex;
  return null;
}

/** Keys (`documentId:pageIndex`) of the pages needed to detect detached notes. */
export function pagesNeededForNotes(annotations: readonly Annotation[]): [Id, number][] {
  const keys = new Map<string, [Id, number]>();
  for (const a of annotations) {
    if (a.deletedAt !== null || a.documentId === null) continue;
    const pageIndex = textAnchorPage(a);
    if (pageIndex !== null) keys.set(pageKey(a.documentId, pageIndex), [a.documentId, pageIndex]);
  }
  return Array.from(keys.values());
}

function isDetached(a: TextHighlight | InkAnnotation, pages: ReadonlyMap<string, PageContent>, reanchor: NotesInput['reanchor']): boolean {
  const pageIndex = textAnchorPage(a);
  if (pageIndex === null || a.documentId === null) return false;
  const page = pages.get(pageKey(a.documentId, pageIndex));
  // Page not on this device yet: unknown, not detached.
  if (!page || page.status === 'pending' || page.status === 'processing') return false;
  const source: ReanchorSource | null = a.type === 'highlight' ? a : a.space.kind === 'text' ? a.space : null;
  if (source === null) return false;
  try {
    return reanchor(source, page) === 'orphan';
  } catch {
    return false;
  }
}

/** Groups the child's notes by book, most recent activity first. */
export function buildNotes(input: NotesInput): DocumentNotes[] {
  const pages = new Map(input.pages.map((p) => [pageKey(p.documentId, p.pageIndex), p]));
  const groups = new Map<Id, DocumentNotes>();
  const documents = new Map(input.documents.filter((d) => d.deletedAt === null).map((d) => [d.id, d]));

  const group = (documentId: Id): DocumentNotes | null => {
    const document = documents.get(documentId);
    if (!document) return null;
    let g = groups.get(documentId);
    if (!g) {
      g = { documentId, title: document.title, firstPageIndex: null, highlights: [], inkCount: 0, answers: [], detached: [], lastActivityAt: 0 };
      groups.set(documentId, g);
    }
    return g;
  };
  const touchPage = (g: DocumentNotes, pageIndex: number): void => {
    if (g.firstPageIndex === null || pageIndex < g.firstPageIndex) g.firstPageIndex = pageIndex;
  };

  const highlightOrder = new Map<Id, [number, number, number]>();
  for (const a of input.annotations) {
    if (a.deletedAt !== null || a.documentId === null) continue;
    // Answers and the text boxes of homework pages (§19.2) are not reading notes.
    if ((a.type === 'ink' && a.space.kind === 'answer') || a.type === 'textbox') continue;
    const g = group(a.documentId);
    if (!g) continue;
    g.lastActivityAt = Math.max(g.lastActivityAt, a.updatedAt);

    if (isDetached(a, pages, input.reanchor)) {
      const pageIndex = textAnchorPage(a) ?? 0;
      const text = a.type === 'highlight' ? a.text : a.space.kind === 'text' ? a.space.contextText : '';
      g.detached.push({ id: a.id, kind: a.type === 'highlight' ? 'highlight' : 'ink', text: text.trim(), pageIndex });
      continue;
    }
    if (a.type === 'highlight') {
      g.highlights.push({ id: a.id, text: a.text.trim(), color: a.color, pageIndex: a.pageIndex });
      highlightOrder.set(a.id, [a.pageIndex, a.blockIndex, a.start]);
      touchPage(g, a.pageIndex);
    } else if (a.space.kind !== 'answer') {
      g.inkCount += 1;
      touchPage(g, a.space.pageIndex);
    }
  }

  const exercises = new Map(input.exercises.filter((e) => e.deletedAt === null).map((e) => [e.id, e]));
  const latestAnswers = new Map<string, Answer>();
  for (const answer of input.answers) {
    const key = `${answer.exerciseId}:${answer.questionId}`;
    const previous = latestAnswers.get(key);
    if (!previous || answer.updatedAt > previous.updatedAt) latestAnswers.set(key, answer);
  }
  for (const answer of latestAnswers.values()) {
    const exercise = exercises.get(answer.exerciseId);
    if (!exercise) continue;
    const text = answer.response.type === 'reponse_libre' ? answer.response.text.trim() : '';
    const drawn = answer.inkAnnotationId !== null;
    if (text === '' && !drawn) continue;
    const g = group(exercise.documentId);
    if (!g) continue;
    const question = exercise.questions.find((q) => q.id === answer.questionId);
    g.answers.push({ id: answer.id, exerciseId: exercise.id, prompt: question?.prompt ?? '', text: text === '' ? null : text, drawn });
    g.lastActivityAt = Math.max(g.lastActivityAt, answer.updatedAt);
  }

  for (const g of groups.values()) {
    g.highlights.sort((a, b) => {
      const x = highlightOrder.get(a.id) ?? [0, 0, 0];
      const y = highlightOrder.get(b.id) ?? [0, 0, 0];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
    g.detached.sort((a, b) => a.pageIndex - b.pageIndex);
  }

  return Array.from(groups.values())
    .filter((g) => g.highlights.length > 0 || g.inkCount > 0 || g.answers.length > 0 || g.detached.length > 0)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}
