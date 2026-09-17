import { DEFAULT_PARENT_SETTINGS, KID_MESSAGES, QUESTION_TYPES, type Question } from '@aide/shared';
import { describe, expect, it } from 'vitest';
import { exercises as t } from '../../src/i18n/fr/exercises';
import { aiFeatureEnabled, handwritingRecognitionEnabled, kidMessage } from '../../src/features/exercises/lib/aiResults';
import {
  EMPTY_ASSOCIATION, isAssociationComplete, selectLeft, selectRight, toResponsePairs, undoLast,
} from '../../src/features/exercises/lib/association';
import {
  clampRange, initialSelection, isDocumentVisibleToChild, pagesAroundSource, selectPages, stepRange, toAIPageInputs,
} from '../../src/features/exercises/lib/documentPages';
import { cleanQuestions, isPlayableQuestion, profileQuestionTypes } from '../../src/features/exercises/lib/generation';
import { planInkRaster } from '../../src/features/exercises/lib/handwriting';
import { parseQuestionParam, questionParam, readerLink } from '../../src/features/exercises/lib/links';
import { moveItem, shuffledIndexes } from '../../src/features/exercises/lib/ordering';
import {
  answerDisplay, cheerFor, firstUnansweredIndex, latestAnswers, scoreExercise,
} from '../../src/features/exercises/lib/score';
import { rightAnswerLines, scoreLine } from '../../src/features/exercises/lib/texts';
import {
  ASSOCIATION, CHILD_ID, LIBRE, makeAnswer, makeDoc, makeExercise, makeInk, makePage, META, ORDRE, QCM, VRAI_FAUX,
} from './fixtures';

describe('page selection', () => {
  it('clamps and orders ranges', () => {
    expect(clampRange({ from: -3, to: 99 }, 5)).toEqual({ from: 0, to: 4 });
    expect(clampRange({ from: 4, to: 1 }, 5)).toEqual({ from: 1, to: 4 });
    expect(clampRange({ from: 2, to: 2 }, 0)).toEqual({ from: 0, to: 0 });
  });

  it('steps one end and pushes the other one', () => {
    expect(stepRange({ from: 2, to: 2 }, 'from', 1, 10)).toEqual({ from: 3, to: 3 });
    expect(stepRange({ from: 3, to: 3 }, 'to', -1, 10)).toEqual({ from: 2, to: 2 });
    expect(stepRange({ from: 0, to: 9 }, 'to', 1, 10)).toEqual({ from: 0, to: 9 });
    expect(stepRange({ from: 0, to: 4 }, 'from', -1, 10)).toEqual({ from: 0, to: 4 });
  });

  it('starts on the page given in the URL (1-based) or on the whole book', () => {
    expect(initialSelection(10, '4')).toEqual({ mode: 'range', range: { from: 3, to: 3 } });
    expect(initialSelection(10, '40')).toEqual({ mode: 'range', range: { from: 9, to: 9 } });
    expect(initialSelection(10, null)).toEqual({ mode: 'all', range: { from: 0, to: 9 } });
    expect(initialSelection(10, 'abc')).toEqual({ mode: 'all', range: { from: 0, to: 9 } });
  });

  it('keeps only readable pages and counts the others', () => {
    const pages = [
      makePage(0, 'Un texte.'),
      makePage(1, '', { status: 'pending' }),
      makePage(2, 'Texte douteux.', { status: 'low_confidence' }),
      makePage(3, 'Échec.', { status: 'failed' }),
    ];
    const all = selectPages(pages, { mode: 'all', range: { from: 0, to: 0 } }, 5);
    expect(all.readable.map((p) => p.pageIndex)).toEqual([0, 2]);
    expect(all.notReady).toBe(3);
    const some = selectPages(pages, { mode: 'range', range: { from: 1, to: 2 } }, 5);
    expect(some.readable.map((p) => p.pageIndex)).toEqual([2]);
    expect(some.notReady).toBe(1);
  });

  it('builds AI inputs with low-confidence flags and a size cap', async () => {
    const pages = [makePage(1, 'b'.repeat(40)), makePage(0, 'a'.repeat(40), { warnings: ['low_confidence'] }), makePage(2, 'c'.repeat(40))];
    const full = await toAIPageInputs(pages);
    expect(full.truncated).toBe(false);
    expect(full.inputs.map((p) => p.pageIndex)).toEqual([0, 1, 2]);
    expect(full.inputs[0]).toMatchObject({ contentHash: 'hash-0', ocrLowConfidence: true });

    const capped = await toAIPageInputs(pages, 90);
    expect(capped.truncated).toBe(true);
    expect(capped.inputs.map((p) => p.pageIndex)).toEqual([0, 1]);

    const cut = await toAIPageInputs([makePage(0, 'x'.repeat(100))], 30);
    expect(cut.truncated).toBe(true);
    expect(cut.inputs[0]?.text).toHaveLength(30);
    expect(cut.inputs[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sends the source page and its neighbours with a written answer', () => {
    const pages = [0, 1, 2, 3, 4].map((i) => ({ pageIndex: i }));
    expect(pagesAroundSource(pages, 2).map((p) => p.pageIndex)).toEqual([1, 2, 3]);
    expect(pagesAroundSource(pages, 0).map((p) => p.pageIndex)).toEqual([0, 1]);
    expect(pagesAroundSource(pages, 9).map((p) => p.pageIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('shows books assigned to the child or to nobody, never deleted ones', () => {
    expect(isDocumentVisibleToChild(makeDoc(), CHILD_ID)).toBe(true);
    expect(isDocumentVisibleToChild(makeDoc({ childIds: [] }), CHILD_ID)).toBe(true);
    expect(isDocumentVisibleToChild(makeDoc({ childIds: ['other'] }), CHILD_ID)).toBe(false);
    expect(isDocumentVisibleToChild(makeDoc({ deletedAt: 5 }), CHILD_ID)).toBe(false);
  });
});

describe('links', () => {
  it('opens the reader on a 1-based page with the quote', () => {
    const url = readerLink('doc 1', { pageIndex: 4, quote: '  Le soleil chauffe l’eau.  ' });
    const [path, query] = url.split('?');
    expect(path).toBe('/lire/doc%201');
    const params = new URLSearchParams(query);
    expect(params.get('page')).toBe('5');
    expect(params.get('quote')).toBe('Le soleil chauffe l’eau.');
    expect(readerLink('d')).toBe('/lire/d');
  });

  it('round-trips the quiz position', () => {
    expect(questionParam(0, 5)).toBe('1');
    expect(questionParam(5, 5)).toBe('fin');
    expect(parseQuestionParam('3', 5)).toBe(2);
    expect(parseQuestionParam('fin', 5)).toBe(5);
    expect(parseQuestionParam('0', 5)).toBeNull();
    expect(parseQuestionParam('6', 5)).toBeNull();
    expect(parseQuestionParam('2.5', 5)).toBeNull();
    expect(parseQuestionParam(null, 5)).toBeNull();
  });
});

describe('association state', () => {
  const lefts = ['A', 'B', 'C'];
  const rights = ['z', 'x', 'y'];

  it('links left then right, relinks and undoes', () => {
    let s = selectLeft(EMPTY_ASSOCIATION, 0);
    expect(s.selectedLeft).toBe(0);
    s = selectRight(s, 1);
    expect(s).toEqual({ links: [{ left: 0, right: 1 }], selectedLeft: null });
    s = selectRight(selectLeft(s, 1), 1); // right 1 moves to left 1
    expect(s.links).toEqual([{ left: 1, right: 1 }]);
    s = selectRight(selectLeft(s, 0), 2);
    s = selectRight(selectLeft(s, 2), 0);
    expect(isAssociationComplete(s, 3)).toBe(true);
    expect(toResponsePairs(s, lefts, rights)).toEqual([
      { left: 'A', right: 'y' },
      { left: 'B', right: 'x' },
      { left: 'C', right: 'z' },
    ]);
    s = undoLast(s);
    expect(s.links).toHaveLength(2);
    expect(isAssociationComplete(s, 3)).toBe(false);
  });

  it('unlinks by tapping a linked item and cancels a selection', () => {
    let s = selectRight(selectLeft(EMPTY_ASSOCIATION, 0), 0);
    expect(selectRight(s, 0).links).toEqual([]);
    s = selectLeft(s, 0);
    expect(s).toEqual({ links: [], selectedLeft: 0 });
    expect(selectLeft(s, 0).selectedLeft).toBeNull();
    expect(undoLast(s)).toEqual({ links: [], selectedLeft: null });
    expect(selectRight(EMPTY_ASSOCIATION, 2)).toBe(EMPTY_ASSOCIATION);
  });
});

describe('ordering', () => {
  it('shuffles deterministically and never keeps the right order', () => {
    for (let n = 2; n <= 8; n += 1) {
      for (const seed of ['a', 'b', 'q4:ordre', 'x']) {
        const order = shuffledIndexes(n, seed);
        expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
        expect(order.every((v, i) => v === i)).toBe(false);
        expect(shuffledIndexes(n, seed)).toEqual(order);
      }
    }
    expect(shuffledIndexes(1, 'a')).toEqual([0]);
    expect(shuffledIndexes(0, 'a')).toEqual([]);
  });

  it('moves items with the arrows', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('score', () => {
  const exercise = makeExercise([QCM, VRAI_FAUX, ASSOCIATION, ORDRE, LIBRE]);

  it('uses the latest answer per question', () => {
    const old = makeAnswer('q1', { id: 'old', verdict: 'incorrect', updatedAt: 1 });
    const recent = makeAnswer('q1', { id: 'new', verdict: 'correct', updatedAt: 2 });
    expect(latestAnswers([recent, old]).get('q1')?.id).toBe('new');
  });

  it('counts verdicts, unscored answers and completion', () => {
    const answers = [
      makeAnswer('q1', { verdict: 'correct' }),
      makeAnswer('q2', { verdict: 'incorrect' }),
      makeAnswer('q3', { verdict: 'partiel' }),
      makeAnswer('q5', { verdict: null, feedback: null, correctedBy: null }),
      makeAnswer('q4', { exerciseId: 'other', verdict: 'correct' }),
    ];
    const score = scoreExercise(exercise, answers);
    expect(score).toEqual({ total: 5, answered: 4, correct: 1, partiel: 1, incorrect: 1, unscored: 1, complete: false });
    expect(firstUnansweredIndex(exercise, latestAnswers(answers.filter((a) => a.exerciseId === 'ex-1')))).toBe(3);
    expect(scoreLine(score)).toBe('À continuer : 4 sur 5');
  });

  it('is always encouraging', () => {
    const base = { total: 4, answered: 4, unscored: 0, complete: true };
    expect(cheerFor({ ...base, correct: 4, partiel: 0, incorrect: 0 })).toBe('all');
    expect(cheerFor({ ...base, correct: 3, partiel: 0, incorrect: 1 })).toBe('great');
    expect(cheerFor({ ...base, correct: 1, partiel: 2, incorrect: 1 })).toBe('good');
    expect(cheerFor({ ...base, correct: 0, partiel: 0, incorrect: 4 })).toBe('keepGoing');
    expect(cheerFor({ ...base, correct: 0, partiel: 0, incorrect: 0, unscored: 4 })).toBe('good');
    for (const text of Object.values(t.score.cheer)) expect(text).not.toMatch(/faux|nul|raté|mauvais/i);
  });

  it('writes a short score line with French plurals', () => {
    const done = { total: 5, answered: 5, correct: 3, partiel: 1, incorrect: 0, unscored: 1, complete: true };
    expect(scoreLine(done)).toBe('3 bonnes réponses sur 5 · 1 réponse presque juste · 1 réponse comparée toi-même');
    expect(scoreLine({ ...done, correct: 1, partiel: 0, unscored: 0 })).toBe('1 bonne réponse sur 5');
    expect(scoreLine({ ...done, answered: 0, complete: false })).toBe(t.home.past.notStarted);
  });

  it('distinguishes verdicts, self-checks and adult messages', () => {
    expect(answerDisplay(makeAnswer('q1', { verdict: 'partiel' }))).toBe('partiel');
    expect(answerDisplay(makeAnswer('q5', { verdict: null, feedback: null }))).toBe('self_check');
    expect(answerDisplay(makeAnswer('q5', { verdict: null, feedback: KID_MESSAGES.adultRedirect }))).toBe('message');
  });
});

describe('questions', () => {
  it('rejects questions the player cannot show', () => {
    expect([QCM, VRAI_FAUX, ASSOCIATION, ORDRE, LIBRE].every(isPlayableQuestion)).toBe(true);
    expect(isPlayableQuestion({ ...QCM, correctIndex: 3 } as Question)).toBe(false);
    expect(isPlayableQuestion({ ...QCM, choices: ['Seul'], correctIndex: 0 } as Question)).toBe(false);
    expect(isPlayableQuestion({ ...ORDRE, itemsInOrder: ['Un'] } as Question)).toBe(false);
    expect(isPlayableQuestion({ ...ASSOCIATION, pairs: [{ left: 'a', right: '' }, { left: 'b', right: 'c' }] } as Question)).toBe(false);
    expect(isPlayableQuestion({ ...LIBRE, expectedAnswer: ' ' } as Question)).toBe(false);
    expect(isPlayableQuestion({ ...QCM, prompt: '' } as Question)).toBe(false);
  });

  it('filters types, dedupes ids and caps the count', () => {
    const cleaned = cleanQuestions([QCM, { ...QCM }, VRAI_FAUX, LIBRE, ORDRE], ['qcm', 'reponse_libre', 'ordre'], 3);
    expect(cleaned.map((q) => q.id)).toEqual(['q1', 'q1-2', 'q5']);
  });

  it('uses the profile types in canonical order', () => {
    expect(profileQuestionTypes(['ordre', 'qcm'])).toEqual(['qcm', 'ordre']);
    expect(profileQuestionTypes([])).toEqual([...QUESTION_TYPES]);
  });

  it('describes the right answer of closed questions', () => {
    expect(rightAnswerLines(QCM)?.lines).toEqual(['Le soleil']);
    expect(rightAnswerLines(VRAI_FAUX)?.lines).toEqual(['Faux']);
    expect(rightAnswerLines(ASSOCIATION)?.lines[0]).toBe('Le soleil → chauffe l’eau');
    expect(rightAnswerLines(ORDRE)?.lines).toEqual(['1. L’eau devient de la vapeur.', '2. La vapeur forme des nuages.', '3. Il pleut.']);
    expect(rightAnswerLines(LIBRE)).toBeNull();
  });
});

describe('AI results and settings', () => {
  it('reads the parent switches', () => {
    expect(aiFeatureEnabled(null, 'questions')).toBe(true);
    const off = { ...DEFAULT_PARENT_SETTINGS, ai: { ...DEFAULT_PARENT_SETTINGS.ai, enabled: false } };
    expect(aiFeatureEnabled(off, 'summarize')).toBe(false);
    const noSummary = { ...DEFAULT_PARENT_SETTINGS, ai: { ...DEFAULT_PARENT_SETTINGS.ai, features: { ...DEFAULT_PARENT_SETTINGS.ai.features, summarize: false } } };
    expect(aiFeatureEnabled(noSummary, 'summarize')).toBe(false);
    expect(aiFeatureEnabled(noSummary, 'questions')).toBe(true);
    expect(handwritingRecognitionEnabled(DEFAULT_PARENT_SETTINGS)).toBe(false);
    expect(handwritingRecognitionEnabled({ ...DEFAULT_PARENT_SETTINGS, ai: { ...DEFAULT_PARENT_SETTINGS.ai, handwritingRecognition: true } })).toBe(true);
  });

  it('falls back to the standard kid messages', () => {
    expect(kidMessage({ status: 'unavailable', reason: 'offline', message: '', meta: null })).toBe(KID_MESSAGES.offline);
    expect(kidMessage({ status: 'unavailable', reason: 'quota', message: '', meta: null })).toBe(KID_MESSAGES.quota);
    expect(kidMessage({ status: 'blocked', reason: 'adult_redirect', message: '', meta: META })).toBe(KID_MESSAGES.adultRedirect);
    expect(kidMessage({ status: 'blocked', reason: 'refusal', message: '', meta: META })).toBe(KID_MESSAGES.blocked);
    expect(kidMessage({ status: 'not_in_text', message: 'Message du serveur', meta: META })).toBe('Message du serveur');
  });
});

describe('handwriting raster', () => {
  it('crops the ink with a margin and keeps proportions', () => {
    const raster = planInkRaster([makeInk('i1', [[0.1, 0.1], [0.3, 0.2]]), makeInk('i2', [[0.2, 0.15]])]);
    expect(raster).not.toBeNull();
    if (!raster) return;
    // box width 1000 px: ink spans 200 x 100 px plus stroke width (4 px) and 24 px margins
    expect(raster.width).toBe(252);
    expect(raster.height).toBe(152);
    expect(raster.strokes).toHaveLength(2);
    expect(raster.strokes[0]?.points[0]).toEqual({ x: 26, y: 26 });
  });

  it('scales down to the maximum side and ignores highlighter when there is writing', () => {
    const raster = planInkRaster(
      [makeInk('i1', [[0, 0], [2, 1]]), makeInk('h', [[5, 5], [6, 6]], { tool: 'highlighter', width: 0.05 })],
      500,
    );
    expect(raster?.width).toBeLessThanOrEqual(500);
    expect(raster?.strokes).toHaveLength(1);
    expect(planInkRaster([])).toBeNull();
    expect(planInkRaster([makeInk('empty', [])])).toBeNull();
  });
});
