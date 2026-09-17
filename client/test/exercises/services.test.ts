import type { AIPageInput, AIResult, Exercise, QuestionsData, SummaryData } from '@aide/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { buildAnswer, correctResponse, loadCorrectionPages, saveAnswer } from '../../src/features/exercises/lib/correction';
import { createExercise, duplicateExercise } from '../../src/features/exercises/lib/generation';
import { recognizeAnswerInk, type InkRaster } from '../../src/features/exercises/lib/handwriting';
import { buildSummary } from '../../src/features/exercises/lib/summary';
import {
  ASSOCIATION, CHILD_ID, DOC_ID, LIBRE, makeExercise, makeInk, makePage, META, ORDRE, PAGE_TEXTS, QCM, VRAI_FAUX,
} from './fixtures';

const mocks = vi.hoisted(() => ({
  requestAI: vi.fn(),
  summarizeProgressively: vi.fn(),
  saveEntity: vi.fn(),
  extractiveSummary: vi.fn(),
  generateLocalQuestions: vi.fn(),
}));

vi.mock('../../src/ai/aiClient', () => ({
  requestAI: mocks.requestAI,
  summarizeProgressively: mocks.summarizeProgressively,
  lookupDefinition: vi.fn(),
}));

vi.mock('../../src/sync/SyncEngine', () => ({ saveEntity: mocks.saveEntity }));

vi.mock('@aide/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aide/shared')>();
  return { ...actual, extractiveSummary: mocks.extractiveSummary, generateLocalQuestions: mocks.generateLocalQuestions };
});

const PAGES: AIPageInput[] = PAGE_TEXTS.map((text, pageIndex) => ({ pageIndex, text, contentHash: `h${pageIndex}`, ocrLowConfidence: false }));
const LOCAL_SUMMARY: SummaryData = {
  summary: 'Le soleil chauffe l’eau de la mer.',
  keyPoints: ['Le soleil chauffe l’eau de la mer.'],
  sourceRefs: [{ pageIndex: 0, quote: 'Le soleil chauffe l’eau de la mer.' }],
};

function unavailable<T>(reason: 'offline' | 'not_configured' = 'offline'): AIResult<T> {
  return { status: 'unavailable', reason, message: 'Pas de connexion pour le moment.', meta: null };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  mocks.saveEntity.mockImplementation(async (table: string, entity: unknown) => {
    await db.table(table).put(entity);
  });
  mocks.extractiveSummary.mockReturnValue(LOCAL_SUMMARY);
  mocks.generateLocalQuestions.mockReturnValue([QCM, ORDRE]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildSummary', () => {
  const base = { childId: CHILD_ID, documentId: DOC_ID, documentHash: 'hash', level: 'normal' as const, pages: PAGES };

  it('returns the online summary with progress and the OCR warning', async () => {
    const data: SummaryData = { summary: 'Résumé en ligne.', keyPoints: ['Un point'], sourceRefs: [] };
    mocks.summarizeProgressively.mockImplementation(async (_req, onProgress: (d: number, t: number) => void) => {
      onProgress(1, 2);
      onProgress(2, 2);
      return { status: 'ok', data, meta: { ...META, sourceWarning: true } };
    });
    const progress: [number, number][] = [];
    const outcome = await buildSummary({ ...base, aiAllowed: true, onProgress: (d, t) => progress.push([d, t]) });
    expect(outcome).toEqual({ kind: 'ok', data, origin: 'ai', sourceWarning: true });
    expect(progress).toEqual([[1, 2], [2, 2]]);
    expect(mocks.summarizeProgressively.mock.calls[0]?.[0]).toEqual({ ...base });
    expect(mocks.extractiveSummary).not.toHaveBeenCalled();
  });

  it('labels a summary made by the server without online help as local', async () => {
    mocks.summarizeProgressively.mockResolvedValue({ status: 'ok', data: LOCAL_SUMMARY, meta: { ...META, route: 'local' } });
    const outcome = await buildSummary({ ...base, aiAllowed: true, onProgress: () => {} });
    expect(outcome).toMatchObject({ kind: 'ok', origin: 'local' });
  });

  it('falls back to the local extractive summary when the help is unavailable', async () => {
    mocks.summarizeProgressively.mockResolvedValue(unavailable());
    const lowPages = PAGES.map((p, i) => ({ ...p, ocrLowConfidence: i === 1 }));
    const outcome = await buildSummary({ ...base, pages: lowPages, aiAllowed: true, onProgress: () => {} });
    expect(outcome).toEqual({ kind: 'ok', data: LOCAL_SUMMARY, origin: 'local', sourceWarning: true });
    expect(mocks.extractiveSummary).toHaveBeenCalledWith(lowPages, 'normal');
  });

  it('does not call the network when the parent turned the summary off', async () => {
    const outcome = await buildSummary({ ...base, aiAllowed: false, onProgress: () => {} });
    expect(outcome).toMatchObject({ kind: 'ok', origin: 'local' });
    expect(mocks.summarizeProgressively).not.toHaveBeenCalled();
  });

  it('never summarizes a blocked passage locally', async () => {
    mocks.summarizeProgressively.mockResolvedValue({ status: 'blocked', reason: 'safety_input', message: 'Demande à un adulte.', meta: META });
    const outcome = await buildSummary({ ...base, aiAllowed: true, onProgress: () => {} });
    expect(outcome).toEqual({ kind: 'blocked', message: 'Demande à un adulte.' });
    expect(mocks.extractiveSummary).not.toHaveBeenCalled();
  });

  it('reports unavailable when even the local summary is empty, and aborted when stopped', async () => {
    mocks.summarizeProgressively.mockResolvedValue(unavailable());
    mocks.extractiveSummary.mockReturnValue({ summary: '', keyPoints: [], sourceRefs: [] });
    expect(await buildSummary({ ...base, aiAllowed: true, onProgress: () => {} })).toEqual({ kind: 'unavailable', message: 'Pas de connexion pour le moment.' });
    expect(await buildSummary({ ...base, pages: [], aiAllowed: true, onProgress: () => {} })).toEqual({ kind: 'unavailable', message: null });

    const controller = new AbortController();
    mocks.summarizeProgressively.mockImplementation(async () => {
      controller.abort();
      return unavailable();
    });
    expect(await buildSummary({ ...base, aiAllowed: true, onProgress: () => {}, signal: controller.signal })).toEqual({ kind: 'aborted' });
  });
});

describe('createExercise', () => {
  const base = { childId: CHILD_ID, documentId: DOC_ID, documentHash: 'hash', pages: PAGES, count: 5 as const, now: 1234 };

  it('saves online questions through the sync engine', async () => {
    const result: AIResult<QuestionsData> = { status: 'ok', data: { questions: [QCM, LIBRE, { ...QCM, correctIndex: 9 }] }, meta: META };
    mocks.requestAI.mockResolvedValue(result);
    const outcome = await createExercise({ ...base, types: ['qcm', 'reponse_libre'], aiAllowed: true });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.exercise).toMatchObject({ childId: CHILD_ID, documentId: DOC_ID, pageIndexes: [0, 1, 2], origin: 'ai', createdAt: 1234, deletedAt: null });
    expect(outcome.exercise.questions.map((q) => q.id)).toEqual(['q1', 'q5']);
    expect(mocks.requestAI).toHaveBeenCalledWith(
      'generate_questions',
      { childId: CHILD_ID, documentId: DOC_ID, documentHash: 'hash', count: 5, types: ['qcm', 'reponse_libre'], pages: PAGES },
      { signal: undefined },
    );
    expect(mocks.saveEntity).toHaveBeenCalledWith('exercises', outcome.exercise);
    expect(await db.exercises.get(outcome.exercise.id)).toEqual(outcome.exercise);
  });

  it('builds local questions when the help is unavailable', async () => {
    mocks.requestAI.mockResolvedValue(unavailable());
    const outcome = await createExercise({ ...base, types: ['qcm', 'reponse_libre', 'ordre'], aiAllowed: true });
    expect(outcome).toMatchObject({ kind: 'ok', exercise: { origin: 'local' } });
    expect(mocks.generateLocalQuestions).toHaveBeenCalledWith(PAGES, 5, ['qcm', 'ordre'], 1234);
  });

  it('uses the local types when the profile only allows types the local generator cannot build', async () => {
    mocks.generateLocalQuestions.mockImplementation((_p, _c, types: string[]) => (types.includes('qcm') ? [QCM] : []));
    const outcome = await createExercise({ ...base, types: ['reponse_libre', 'association'], aiAllowed: false });
    expect(outcome).toMatchObject({ kind: 'ok', exercise: { origin: 'local', questions: [QCM] } });
    expect(mocks.requestAI).not.toHaveBeenCalled();
  });

  it('shows the blocked message, but retries locally after a validation failure', async () => {
    mocks.requestAI.mockResolvedValueOnce({ status: 'blocked', reason: 'safety_input', message: 'Parles-en avec un adulte.', meta: META });
    expect(await createExercise({ ...base, types: ['qcm'], aiAllowed: true })).toEqual({ kind: 'blocked', message: 'Parles-en avec un adulte.' });
    expect(mocks.saveEntity).not.toHaveBeenCalled();

    mocks.requestAI.mockResolvedValueOnce({ status: 'blocked', reason: 'validation', message: 'x', meta: META });
    expect(await createExercise({ ...base, types: ['qcm'], aiAllowed: true })).toMatchObject({ kind: 'ok', exercise: { origin: 'local' } });
  });

  it('reports empty when nothing can be built, and aborted when stopped', async () => {
    mocks.requestAI.mockResolvedValue({ status: 'ok', data: { questions: [] }, meta: META });
    mocks.generateLocalQuestions.mockReturnValue([]);
    expect(await createExercise({ ...base, types: ['qcm'], aiAllowed: true })).toEqual({ kind: 'empty' });
    expect(await createExercise({ ...base, pages: [], types: ['qcm'], aiAllowed: true })).toEqual({ kind: 'empty' });

    const controller = new AbortController();
    controller.abort();
    expect(await createExercise({ ...base, types: ['qcm'], aiAllowed: true, signal: controller.signal })).toEqual({ kind: 'aborted' });
  });

  it('duplicates an exercise for « Refaire le quiz »', async () => {
    const source = makeExercise([QCM]);
    const copy = await duplicateExercise(source, 999);
    expect(copy.id).not.toBe(source.id);
    expect(copy).toMatchObject({ questions: source.questions, createdAt: 999, updatedAt: 999, childId: CHILD_ID });
    expect(await db.exercises.get(copy.id)).toEqual(copy);
  });
});

describe('correctResponse', () => {
  const base = { childId: CHILD_ID, documentId: DOC_ID, documentHash: 'hash', pages: PAGES, aiAllowed: true };

  it('corrects closed questions locally without any request', async () => {
    const right = await correctResponse({ ...base, question: QCM, response: { type: 'qcm', choiceIndex: 1 } });
    expect(right).toMatchObject({ kind: 'corrected', verdict: 'correct', correctedBy: 'local', rereadRef: null });
    const wrong = await correctResponse({ ...base, question: VRAI_FAUX, response: { type: 'vrai_faux', value: true } });
    expect(wrong).toMatchObject({ kind: 'corrected', verdict: 'incorrect', correctedBy: 'local', rereadRef: VRAI_FAUX.source });
    expect(mocks.requestAI).not.toHaveBeenCalled();
  });

  it('asks the online correction for written answers', async () => {
    mocks.requestAI.mockResolvedValue({
      status: 'ok',
      data: { verdict: 'partiel', feedback: 'Pense aussi au poids des nuages.', rereadRef: null },
      meta: META,
    });
    const outcome = await correctResponse({ ...base, question: LIBRE, response: { type: 'reponse_libre', text: '  les nuages  ' } });
    expect(outcome).toEqual({ kind: 'corrected', verdict: 'partiel', feedback: 'Pense aussi au poids des nuages.', rereadRef: LIBRE.source, correctedBy: 'ai' });
    expect(mocks.requestAI).toHaveBeenCalledWith(
      'correct_answer',
      { childId: CHILD_ID, documentId: DOC_ID, documentHash: 'hash', question: LIBRE, answerText: 'les nuages', pages: PAGES },
      { signal: undefined },
    );
  });

  it('switches to self-check when the correction is not available', async () => {
    mocks.requestAI.mockResolvedValue(unavailable());
    expect(await correctResponse({ ...base, question: LIBRE, response: { type: 'reponse_libre', text: 'la pluie' } }))
      .toEqual({ kind: 'self_check', message: 'Pas de connexion pour le moment.' });
    expect(await correctResponse({ ...base, aiAllowed: false, question: LIBRE, response: { type: 'reponse_libre', text: 'la pluie' } }))
      .toEqual({ kind: 'self_check', message: null });
    expect(await correctResponse({ ...base, question: LIBRE, response: { type: 'reponse_libre', text: '' } }))
      .toEqual({ kind: 'self_check', message: null });
    expect(mocks.requestAI).toHaveBeenCalledTimes(1);
  });

  it('keeps the adult redirect message', async () => {
    mocks.requestAI.mockResolvedValue({ status: 'blocked', reason: 'adult_redirect', message: 'Parles-en avec un adulte de confiance. 💛', meta: META });
    expect(await correctResponse({ ...base, question: LIBRE, response: { type: 'reponse_libre', text: 'je suis triste' } }))
      .toEqual({ kind: 'adult_redirect', message: 'Parles-en avec un adulte de confiance. 💛' });
  });

  it('builds and saves the Answer entity for every outcome', async () => {
    const common = { exerciseId: 'ex-1', childId: CHILD_ID, response: { type: 'reponse_libre' as const, text: 'x' }, inputMethod: 'clavier' as const, inkAnnotationId: null, now: 50 };
    const corrected = buildAnswer({ ...common, question: LIBRE, outcome: { kind: 'corrected', verdict: 'correct', feedback: 'Exact', rereadRef: null, correctedBy: 'ai' } });
    expect(corrected).toMatchObject({ questionId: 'q5', verdict: 'correct', feedback: 'Exact', correctedBy: 'ai', createdAt: 50, updatedAt: 50 });
    const self = buildAnswer({ ...common, question: LIBRE, outcome: { kind: 'self_check', message: 'hors ligne' } });
    expect(self).toMatchObject({ verdict: null, feedback: null, correctedBy: null, rereadRef: LIBRE.source });
    const adult = buildAnswer({ ...common, question: LIBRE, inkAnnotationId: 'ink-1', outcome: { kind: 'adult_redirect', message: 'Parle à un adulte' } });
    expect(adult).toMatchObject({ verdict: null, feedback: 'Parle à un adulte', rereadRef: null, inkAnnotationId: 'ink-1' });
    await saveAnswer(corrected);
    expect(mocks.saveEntity).toHaveBeenCalledWith('answers', corrected);
    expect(await db.answers.get(corrected.id)).toEqual(corrected);
  });

  it('loads only readable pages around the question source', async () => {
    await db.pages.bulkPut([
      makePage(0, PAGE_TEXTS[0] ?? ''),
      makePage(1, PAGE_TEXTS[1] ?? ''),
      makePage(2, PAGE_TEXTS[2] ?? ''),
      makePage(3, 'Autre page.'),
      makePage(4, '', { status: 'pending' }),
    ]);
    const exercise: Exercise = makeExercise([QCM, LIBRE], { pageIndexes: [0, 1, 2, 3, 4] });
    const pages = await loadCorrectionPages(exercise, LIBRE);
    expect(pages.map((p) => p.pageIndex)).toEqual([1, 2, 3]);
    const narrow = await loadCorrectionPages({ ...exercise, pageIndexes: [2] }, ASSOCIATION);
    expect(narrow.map((p) => p.pageIndex)).toEqual([2]);
  });
});

describe('recognizeAnswerInk', () => {
  const base = { childId: CHILD_ID, exerciseId: 'ex-1', questionId: 'q5', exerciseCreatedAt: 100, documentId: DOC_ID, documentHash: 'hash' };

  it('sends the rendered answer ink and returns the text to confirm', async () => {
    await db.annotations.bulkPut([
      makeInk('i1', [[0.1, 0.1], [0.2, 0.12]]),
      makeInk('deleted', [[0.5, 0.5], [0.6, 0.6]], { deletedAt: 3 }),
      makeInk('other-question', [[0.5, 0.5]], { space: { kind: 'answer', exerciseId: 'ex-1', questionId: 'q9' } }),
    ]);
    const render = vi.fn((_raster: InkRaster) => 'iVBORw0KGgo=');
    mocks.requestAI.mockResolvedValue({ status: 'ok', data: { text: '  les nuages sont lourds ' }, meta: META });
    const outcome = await recognizeAnswerInk({ ...base, render });
    expect(outcome).toEqual({ kind: 'ok', text: 'les nuages sont lourds' });
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[0]).toMatchObject({ strokes: [{ points: expect.any(Array) }] });
    expect(mocks.requestAI).toHaveBeenCalledWith(
      'recognize_handwriting',
      { childId: CHILD_ID, documentId: DOC_ID, documentHash: 'hash', imagePngBase64: 'iVBORw0KGgo=' },
      { signal: undefined },
    );
  });

  it('handles missing ink, canvas problems, empty text and unavailable help', async () => {
    expect(await recognizeAnswerInk({ ...base, render: () => 'x' })).toEqual({ kind: 'no_ink' });
    await db.annotations.put(makeInk('i1', [[0.1, 0.1], [0.2, 0.2]]));
    expect(await recognizeAnswerInk({ ...base, render: () => null })).toEqual({ kind: 'image_error' });
    expect(await recognizeAnswerInk({ ...base, exerciseCreatedAt: 50_000_000, render: () => 'x' })).toEqual({ kind: 'no_ink' });
    expect(await recognizeAnswerInk({ ...base, render: () => 'A'.repeat(3_000_000) })).toEqual({ kind: 'image_error' });
    mocks.requestAI.mockResolvedValueOnce({ status: 'ok', data: { text: '   ' }, meta: META });
    expect(await recognizeAnswerInk({ ...base, render: () => 'x' })).toEqual({ kind: 'not_read' });
    mocks.requestAI.mockResolvedValueOnce(unavailable('not_configured'));
    expect(await recognizeAnswerInk({ ...base, render: () => 'x' })).toEqual({ kind: 'message', message: 'Pas de connexion pour le moment.' });
  });
});
