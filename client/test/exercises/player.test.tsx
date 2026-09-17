import { DEFAULT_PARENT_SETTINGS, type AnswerResponse, type Question, type Verdict } from '@aide/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import QuizPlayerPage from '../../src/features/exercises/QuizPlayerPage';
import {
  button, cleanup, click, clickButton, location, renderAt, resetDb, setSession, text, typeInto, wait, waitFor, waitForAsync, waitForText,
} from './dom';
import {
  ASSOCIATION, CHILD_ID, DOC_ID, LIBRE, makeAnswer, makeChild, makeDoc, makeExercise, makePage, META, ORDRE, PAGE_TEXTS, QCM,
  VRAI_FAUX,
} from './fixtures';

const mocks = vi.hoisted(() => ({
  requestAI: vi.fn(),
  saveEntity: vi.fn(),
  speakOnce: vi.fn(),
  correctClosedAnswer: vi.fn(),
}));

vi.mock('../../src/ai/aiClient', () => ({ requestAI: mocks.requestAI, summarizeProgressively: vi.fn(), lookupDefinition: vi.fn() }));
vi.mock('../../src/sync/SyncEngine', () => ({ saveEntity: mocks.saveEntity }));
vi.mock('../../src/tts/SpeechEngine', () => ({
  SpeechEngine: { isSupported: () => true },
  speechEngine: { speakOnce: mocks.speakOnce, stop: vi.fn() },
}));
vi.mock('../../src/pencil', async () => {
  const { createElement } = await import('react');
  const { db: localDb } = await import('../../src/db/localDb');
  const { makeInk: ink } = await import('./fixtures');
  return {
    AnswerPad: (props: { exerciseId: string; questionId: string; childId: string; onInkSaved?: (id: string) => void }) =>
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'answer-pad',
          onClick: async () => {
            const annotation = ink('ink-1', [[0.1, 0.1], [0.3, 0.2]], { space: { kind: 'answer', exerciseId: props.exerciseId, questionId: props.questionId } });
            await localDb.annotations.put(annotation);
            props.onInkSaved?.(annotation.id);
          },
        },
        'Dessin test',
      ),
  };
});
vi.mock('@aide/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aide/shared')>();
  return { ...actual, correctClosedAnswer: mocks.correctClosedAnswer };
});

function ratioVerdict(ratio: number): Verdict {
  return ratio === 1 ? 'correct' : ratio >= 0.5 ? 'partiel' : 'incorrect';
}

// Reference behaviour of the shared local correction (the real one is tested in shared).
function fakeCorrection(q: Question, r: AnswerResponse): { verdict: Verdict; feedback: string } | null {
  let ratio: number | null = null;
  if (q.type === 'qcm' && r.type === 'qcm') ratio = q.correctIndex === r.choiceIndex ? 1 : 0;
  if (q.type === 'vrai_faux' && r.type === 'vrai_faux') ratio = q.answer === r.value ? 1 : 0;
  if (q.type === 'association' && r.type === 'association') {
    ratio = q.pairs.filter((p) => r.pairs.some((x) => x.left === p.left && x.right === p.right)).length / q.pairs.length;
  }
  if (q.type === 'ordre' && r.type === 'ordre') ratio = q.itemsInOrder.filter((item, i) => r.items[i] === item).length / q.itemsInOrder.length;
  if (ratio === null) return null;
  const verdict = ratioVerdict(ratio);
  return { verdict, feedback: verdict === 'correct' ? 'Bravo !' : 'Relis le passage.' };
}

const ROUTES = [{ path: '/exercices/quiz/:exerciseId', element: <QuizPlayerPage /> }];

async function seed(questions: Question[]): Promise<void> {
  await db.documents.put(makeDoc());
  await db.pages.bulkPut(PAGE_TEXTS.map((t, i) => makePage(i, t)));
  await db.exercises.put(makeExercise(questions));
}

async function answers() {
  return db.answers.where('exerciseId').equals('ex-1').toArray();
}

function orderTexts(): string[] {
  return Array.from(document.querySelectorAll('.ex-order__text')).map((el) => el.textContent ?? '');
}

beforeEach(async () => {
  await resetDb();
  setSession(makeChild());
  mocks.saveEntity.mockImplementation(async (table: string, entity: unknown) => {
    await db.table(table).put(entity);
  });
  mocks.correctClosedAnswer.mockImplementation(fakeCorrection);
  mocks.requestAI.mockResolvedValue({ status: 'unavailable', reason: 'offline', message: 'Pas de connexion pour le moment.', meta: null });
});

afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('QuizPlayerPage', () => {
  it('plays every question type, corrects locally, falls back to self-check and ends with an encouraging result', async () => {
    await seed([QCM, VRAI_FAUX, ASSOCIATION, ORDRE, LIBRE]);
    await renderAt('/exercices/quiz/ex-1', ROUTES);

    // 1. QCM
    await waitForText(QCM.prompt);
    expect(text()).toContain('Question 1 sur 5');
    await click(button('Écouter la question'));
    expect(mocks.speakOnce).toHaveBeenCalledWith([QCM.prompt, ...QCM.choices].join('\n'));
    expect(button('Valider')?.disabled).toBe(true);
    await click(button('Le soleil'));
    expect(button('Le soleil')?.getAttribute('aria-pressed')).toBe('true');
    await click(button('Valider'));
    await waitForText('Exact !');
    expect(mocks.correctClosedAnswer).toHaveBeenCalledWith(QCM, { type: 'qcm', choiceIndex: 1 });
    expect(button('Relire le passage')).toBeNull();
    await waitForAsync(async () => (await answers()).length === 1);

    // 2. Vrai / faux, wrong answer: kind explanation, right answer, reread invitation
    await clickButton('Question suivante');
    await waitForText(VRAI_FAUX.prompt);
    await click(button('Vrai'));
    await click(button('Valider'));
    await waitForText('Pas tout à fait');
    expect(text()).toContain(VRAI_FAUX.explanation);
    expect(text()).toContain('La bonne réponse :');
    expect(text()).not.toMatch(/Sbagliato|Mauvais/);
    expect(button('Relire le passage')).not.toBeNull();

    // 3. Association: left then right, undo a wrong pair
    await clickButton('Question suivante');
    await waitForText(ASSOCIATION.prompt);
    expect(button('Annuler')?.disabled).toBe(true);
    await click(button('Le soleil'));
    await click(button('chauffe l’eau'));
    expect(document.querySelectorAll('.ex-pair-0')).toHaveLength(2);
    await click(button('La vapeur'));
    await click(button('donnent la pluie'));
    await click(button('Annuler'));
    expect(button('La vapeur')).not.toBeNull();
    expect(button('Valider')?.disabled).toBe(true);
    await click(button('La vapeur'));
    await click(button('monte'));
    await click(button('Les nuages'));
    await click(button('donnent la pluie'));
    expect(button('Le soleil, relié au numéro 1')).not.toBeNull();
    await click(button('Valider'));
    await waitForText('Exact !');

    // 4. Order with arrows only
    await clickButton('Question suivante');
    await waitForText(ORDRE.prompt);
    const target = ORDRE.itemsInOrder;
    expect(orderTexts()).not.toEqual(target);
    for (let position = 0; position < target.length; position += 1) {
      const item = target[position] ?? '';
      while (orderTexts().indexOf(item) > position) await click(button(`Monter : ${item}`));
    }
    expect(orderTexts()).toEqual(target);
    await click(button('Valider'));
    await waitForText('Exact !');

    // 5. Written answer while the help is offline: compare with the expected answer
    await clickButton('Question suivante');
    await waitForText(LIBRE.prompt);
    expect(document.querySelector('[data-testid="answer-pad"]')).toBeNull();
    const textarea = await waitFor(() => document.querySelector('textarea'));
    await typeInto(textarea, 'Il pleut quand les nuages sont lourds.');
    await click(button('Valider'));
    await waitForText('Compare avec la réponse attendue');
    expect(text()).toContain('Pas de connexion pour le moment.');
    expect(text()).toContain(LIBRE.expectedAnswer);
    expect(text()).toContain('Il pleut quand les nuages sont lourds.');
    expect(mocks.requestAI).toHaveBeenCalledWith('correct_answer', expect.objectContaining({ answerText: 'Il pleut quand les nuages sont lourds.' }), expect.anything());

    // Result
    await clickButton('Voir mon résultat');
    await waitForText('Très bien ! Tu as bien compris le texte.');
    expect(text()).toContain('3 bonnes réponses sur 5');

    const saved = await answers();
    expect(saved).toHaveLength(5);
    const byQuestion = new Map(saved.map((a) => [a.questionId, a]));
    expect(byQuestion.get('q1')).toMatchObject({ verdict: 'correct', correctedBy: 'local', inputMethod: 'toucher', childId: CHILD_ID });
    expect(byQuestion.get('q2')).toMatchObject({ verdict: 'incorrect', rereadRef: VRAI_FAUX.source });
    expect(byQuestion.get('q3')?.response).toEqual({ type: 'association', pairs: ASSOCIATION.pairs });
    expect(byQuestion.get('q4')).toMatchObject({ verdict: 'correct', response: { type: 'ordre', items: target } });
    expect(byQuestion.get('q5')).toMatchObject({ verdict: null, correctedBy: null, inputMethod: 'clavier', response: { type: 'reponse_libre', text: 'Il pleut quand les nuages sont lourds.' } });
    expect(mocks.saveEntity).toHaveBeenCalledTimes(5);
  });

  it('opens the reader on the passage to reread', async () => {
    await seed([VRAI_FAUX]);
    await renderAt('/exercices/quiz/ex-1', ROUTES);
    await waitForText(VRAI_FAUX.prompt);
    await click(button('Vrai'));
    await click(button('Valider'));
    await clickButton('Relire le passage');
    const url = await waitFor(() => location());
    const [path, query] = url.split('?');
    expect(path).toBe(`/lire/${DOC_ID}`);
    expect(new URLSearchParams(query).get('page')).toBe('2');
    expect(new URLSearchParams(query).get('quote')).toBe(VRAI_FAUX.source.quote);
  });

  it('shows the online correction of a written answer (partly right)', async () => {
    await seed([LIBRE]);
    mocks.requestAI.mockResolvedValue({
      status: 'ok',
      data: { verdict: 'partiel', feedback: 'Pense aussi à ce qui rend les nuages lourds.', rereadRef: null },
      meta: META,
    });
    await renderAt('/exercices/quiz/ex-1', ROUTES);
    const textarea = await waitFor(() => document.querySelector('textarea'));
    await typeInto(textarea, 'les nuages');
    await click(button('Valider'));
    await waitForText('Tu as compris une partie importante…');
    expect(text()).toContain('Pense aussi à ce qui rend les nuages lourds.');
    const [, body] = mocks.requestAI.mock.calls.find((c) => c[0] === 'correct_answer') ?? [];
    expect(body).toMatchObject({ childId: CHILD_ID, documentId: DOC_ID, documentHash: 'a'.repeat(64), question: LIBRE, answerText: 'les nuages' });
    expect((body as { pages: { pageIndex: number }[] }).pages.map((p) => p.pageIndex)).toEqual([1, 2]);
    const [saved] = await answers();
    expect(saved).toMatchObject({ verdict: 'partiel', correctedBy: 'ai', rereadRef: LIBRE.source });
  });

  it('turns a drawing into text after the child confirms it', async () => {
    setSession(makeChild(), { ...DEFAULT_PARENT_SETTINGS, ai: { ...DEFAULT_PARENT_SETTINGS.ai, handwritingRecognition: true } });
    await seed([LIBRE]);
    const fakeContext = new Proxy({}, { get: () => () => undefined, set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,UE5H');
    mocks.requestAI.mockImplementation(async (op: string) => {
      if (op === 'recognize_handwriting') return { status: 'ok', data: { text: 'les nuages sont lourds' }, meta: META };
      return { status: 'ok', data: { verdict: 'correct', feedback: 'Bravo, c’est ça !', rereadRef: null }, meta: META };
    });

    await renderAt('/exercices/quiz/ex-1', ROUTES);
    await waitForText(LIBRE.prompt);
    await click(button('Dessiner'));
    expect(document.querySelector('textarea')).toBeNull();
    expect(button('Transformer en texte')).toBeNull();
    await click(document.querySelector('[data-testid="answer-pad"]'));
    await clickButton('Transformer en texte');
    await waitForText('J’ai lu :');
    expect(mocks.requestAI).toHaveBeenCalledWith('recognize_handwriting', expect.objectContaining({ imagePngBase64: 'UE5H', childId: CHILD_ID }), expect.anything());
    expect(text()).toContain('« les nuages sont lourds »');
    await click(button('Oui, c’est ça'));

    const textarea = await waitFor(() => document.querySelector('textarea'));
    expect(textarea.value).toBe('les nuages sont lourds');
    expect(document.querySelector('[data-testid="answer-pad"]')).toBeNull();
    await click(button('Valider'));
    await waitForText('Exact !');
    const [saved] = await answers();
    expect(saved).toMatchObject({ inputMethod: 'ecriture', inkAnnotationId: 'ink-1', verdict: 'correct', correctedBy: 'ai' });
  });

  it('accepts a drawing-only answer without recognition (self-check)', async () => {
    await seed([LIBRE]);
    await renderAt('/exercices/quiz/ex-1', ROUTES);
    await waitForText(LIBRE.prompt);
    await click(button('Dessiner'));
    expect(button('Valider')?.disabled).toBe(true);
    await click(document.querySelector('[data-testid="answer-pad"]'));
    await waitFor(() => button('Valider')?.disabled === false);
    expect(button('Transformer en texte')).toBeNull();
    await click(button('Valider'));
    await waitForText('Compare avec la réponse attendue');
    expect(text()).toContain('Tu as répondu avec un dessin.');
    expect(mocks.requestAI).not.toHaveBeenCalled();
    const [saved] = await answers();
    expect(saved).toMatchObject({ inputMethod: 'ecriture', inkAnnotationId: 'ink-1', verdict: null, response: { type: 'reponse_libre', text: '' } });
  });

  it('resumes at the first unanswered question and redoes the quiz as a new exercise', async () => {
    await seed([QCM, VRAI_FAUX]);
    await db.answers.put(makeAnswer('q1', { verdict: 'correct' }));
    await renderAt('/exercices/quiz/ex-1', ROUTES);
    await waitForText(VRAI_FAUX.prompt);
    expect(text()).toContain('Question 2 sur 2');
    await click(button('Faux'));
    await click(button('Valider'));
    await waitForText('Exact !');
    await clickButton('Voir mon résultat');
    await waitForText('Bravo, tout est juste !');
    await clickButton('Refaire le quiz');
    await waitForText(QCM.prompt);
    const all = await db.exercises.toArray();
    expect(all).toHaveLength(2);
    expect(text()).toContain('Question 1 sur 2');
    await wait(20);
  });

  it('says so when the exercise does not exist', async () => {
    await renderAt('/exercices/quiz/missing', ROUTES);
    await waitForText('Exercice introuvable');
  });
});
