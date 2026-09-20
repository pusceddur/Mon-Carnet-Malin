import { DEFAULT_PARENT_SETTINGS, KID_MESSAGES, type SummaryData } from '@aide/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import ExercisesHome from '../../src/features/exercises/ExercisesHome';
import QuizSetupPage from '../../src/features/exercises/QuizSetupPage';
import SummaryPage from '../../src/features/exercises/SummaryPage';
import { useSessionStore } from '../../src/state/session';
import {
  button, cleanup, click, clickButton, location, renderAt, resetDb, setSession, text, waitFor, waitForAsync, waitForText,
} from './dom';
import {
  CHILD_ID, DOC_ID, LIBRE, makeAnswer, makeChild, makeDoc, makeExercise, makePage, META, PAGE_TEXTS, QCM, VRAI_FAUX,
} from './fixtures';

const mocks = vi.hoisted(() => ({
  requestAI: vi.fn(),
  summarizeProgressively: vi.fn(),
  saveEntity: vi.fn(),
  extractiveSummary: vi.fn(),
  generateLocalQuestions: vi.fn(),
  speakOnce: vi.fn(),
}));

vi.mock('../../src/ai/aiClient', () => ({
  requestAI: mocks.requestAI,
  summarizeProgressively: mocks.summarizeProgressively,
  lookupDefinition: vi.fn(),
}));
vi.mock('../../src/sync/SyncEngine', () => ({ saveEntity: mocks.saveEntity }));
vi.mock('../../src/tts/SpeechEngine', () => ({
  SpeechEngine: { isSupported: () => true },
  speechEngine: { speakOnce: mocks.speakOnce, stop: vi.fn() },
}));
vi.mock('@aide/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aide/shared')>();
  return { ...actual, extractiveSummary: mocks.extractiveSummary, generateLocalQuestions: mocks.generateLocalQuestions };
});

const SUMMARY: SummaryData = {
  summary: 'Le soleil chauffe l’eau. La vapeur forme des nuages.',
  keyPoints: ['Le soleil chauffe l’eau.', 'Les nuages donnent la pluie.'],
  sourceRefs: [{ pageIndex: 1, quote: 'La vapeur monte dans le ciel et forme des nuages.' }],
};

async function seedBook(): Promise<void> {
  await db.documents.put(makeDoc());
  await db.pages.bulkPut([
    makePage(0, PAGE_TEXTS[0] ?? ''),
    makePage(1, PAGE_TEXTS[1] ?? '', { status: 'low_confidence', warnings: ['low_confidence'] }),
    makePage(2, '', { status: 'processing' }),
  ]);
}

function progressLabel(): string {
  return document.querySelector('.ui-progress__label')?.textContent ?? '';
}

beforeEach(async () => {
  await resetDb();
  setSession(makeChild());
  mocks.saveEntity.mockImplementation(async (table: string, entity: unknown) => {
    await db.table(table).put(entity);
  });
  mocks.extractiveSummary.mockReturnValue(SUMMARY);
  mocks.generateLocalQuestions.mockReturnValue([QCM, VRAI_FAUX]);
});

afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

describe('SummaryPage', () => {
  const ROUTES = [{ path: '/exercices/:documentId/resume', element: <SummaryPage /> }];

  it('shows the progress, then the summary with key points, sources and reading aloud', async () => {
    await seedBook();
    let finish: (value: unknown) => void = () => {};
    mocks.summarizeProgressively.mockImplementation((_req, onProgress: (d: number, t: number) => void) => {
      onProgress(2, 5);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await renderAt(`/exercices/${DOC_ID}/resume`, ROUTES);
    await waitForText('Quelle taille de résumé ?');
    await click(button('Détaillé'));
    expect(text()).toContain('1 page n’est pas encore prête');
    await clickButton('Faire le résumé');

    await waitFor(() => progressLabel() === 'Résumé en cours…');
    await waitForText('2/5');
    const [request] = mocks.summarizeProgressively.mock.calls[0] ?? [];
    expect(request).toMatchObject({ childId: CHILD_ID, documentId: DOC_ID, documentHash: 'a'.repeat(64), level: 'detaille' });
    expect((request as { pages: { pageIndex: number; ocrLowConfidence: boolean }[] }).pages.map((p) => [p.pageIndex, p.ocrLowConfidence]))
      .toEqual([[0, false], [1, true]]);

    finish({ status: 'ok', data: SUMMARY, meta: { ...META, route: 'complex' } });
    await waitForText('Les points importants');
    expect(text()).toContain('La vapeur forme des nuages.');
    expect(text()).toContain(KID_MESSAGES.sourceWarning);
    expect(text()).not.toContain('Résumé préparé sans aide en ligne');

    const link = document.querySelector<HTMLAnchorElement>('a.ex-source');
    expect(link?.textContent).toContain('📍 page 2');
    const href = new URL(link?.getAttribute('href') ?? '', 'https://app.test');
    expect(href.pathname).toBe(`/lire/${DOC_ID}`);
    expect(href.searchParams.get('page')).toBe('2');
    expect(href.searchParams.get('quote')).toBe('La vapeur monte dans le ciel et forme des nuages.');

    await click(button('Écouter le résumé'));
    expect(mocks.speakOnce).toHaveBeenCalledWith(expect.stringContaining('Les nuages donnent la pluie.'));
  });

  it('makes no summary on the device when the help is off', async () => {
    await seedBook();
    setSession(makeChild(), { ...DEFAULT_PARENT_SETTINGS, ai: { ...DEFAULT_PARENT_SETTINGS.ai, enabled: false } });
    await renderAt(`/exercices/${DOC_ID}/resume?page=1`, ROUTES);
    await waitForText('De la page');
    await clickButton('Faire le résumé');
    await waitForText('Pas de résumé pour le moment');
    expect(mocks.summarizeProgressively).not.toHaveBeenCalled();
    expect(mocks.extractiveSummary).not.toHaveBeenCalled();
  });

  it('shows the blocked message', async () => {
    await seedBook();
    mocks.summarizeProgressively.mockResolvedValue({ status: 'blocked', reason: 'safety_input', message: KID_MESSAGES.blocked, meta: META });
    await renderAt(`/exercices/${DOC_ID}/resume`, ROUTES);
    await clickButton('Faire le résumé');
    await waitForText('Pas de résumé pour ce passage');
    expect(text()).toContain(KID_MESSAGES.blocked);
  });

  it('waits kindly while no page is ready', async () => {
    await db.documents.put(makeDoc({ status: 'processing' }));
    await db.pages.put(makePage(0, '', { status: 'processing' }));
    await renderAt(`/exercices/${DOC_ID}/resume`, ROUTES);
    await waitForText('Ce livre n’est pas encore prêt');
  });
});

describe('QuizSetupPage', () => {
  const ROUTES = [{ path: '/exercices/:documentId/questions', element: <QuizSetupPage /> }];

  it('generates questions with the chosen settings, saves the exercise and opens the quiz', async () => {
    await seedBook();
    setSession(makeChild({ exercises: { defaultQuestionCount: 3, enabledTypes: ['qcm', 'reponse_libre', 'ordre'] } }));
    let resolve: (value: unknown) => void = () => {};
    mocks.requestAI.mockImplementation(() => new Promise((r) => {
      resolve = r;
    }));

    await renderAt(`/exercices/${DOC_ID}/questions`, ROUTES);
    await waitForText('Combien de questions ?');
    expect(button('3')?.getAttribute('aria-checked')).toBe('true');
    expect(button('Vrai ou faux')).toBeNull();
    await click(button('10'));
    await click(button('Remettre dans l’ordre'));
    expect(button('Remettre dans l’ordre')?.getAttribute('aria-pressed')).toBe('false');
    await clickButton('C’est parti !');

    await waitForText('Je prépare tes questions…');
    expect(mocks.requestAI).toHaveBeenCalledWith(
      'generate_questions',
      expect.objectContaining({ count: 10, types: ['qcm', 'reponse_libre'], childId: CHILD_ID, documentId: DOC_ID }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    resolve({ status: 'ok', data: { questions: [QCM, LIBRE] }, meta: { ...META, route: 'complex' } });

    const url = await waitFor(() => location().startsWith('/exercices/quiz/') && location());
    const exerciseId = url.split('/').pop() ?? '';
    await waitForAsync(async () => (await db.exercises.get(exerciseId)) !== undefined);
    expect(await db.exercises.get(exerciseId)).toMatchObject({ origin: 'ai', questions: [QCM, LIBRE], childId: CHILD_ID, pageIndexes: [0, 1] });
    expect(mocks.saveEntity).toHaveBeenCalledWith('exercises', expect.objectContaining({ id: exerciseId }));
  });

  it('can stop the wait, and makes no questions on the device when the help is unavailable', async () => {
    await seedBook();
    mocks.requestAI.mockImplementationOnce((_op: string, _body: unknown, opts: { signal: AbortSignal }) => new Promise((r) => {
      opts.signal.addEventListener('abort', () => r({ status: 'unavailable', reason: 'timeout', message: '', meta: null }));
    }));
    await renderAt(`/exercices/${DOC_ID}/questions`, ROUTES);
    await clickButton('C’est parti !');
    await waitForText('Je prépare tes questions…');
    await clickButton('Arrêter');
    await waitForText('Combien de questions ?');
    expect(await db.exercises.count()).toBe(0);

    mocks.requestAI.mockResolvedValue({ status: 'unavailable', reason: 'offline', message: KID_MESSAGES.offline, meta: null });
    await clickButton('C’est parti !');
    await waitForText('Les questions ne sont pas disponibles pour le moment');
    expect(text()).toContain(KID_MESSAGES.offline);
    expect(await db.exercises.count()).toBe(0);
    expect(mocks.generateLocalQuestions).not.toHaveBeenCalled();
    await clickButton('Réessayer');
    await waitForText('Combien de questions ?');
  });
});

describe('ExercisesHome', () => {
  const ROUTES = [{ path: '/exercices', element: <ExercisesHome /> }];

  it('lists the books, offers summary and questions, and shows past exercises with a kind score', async () => {
    await db.documents.bulkPut([makeDoc(), makeDoc({ id: 'hidden', title: 'Livre d’un autre enfant', childIds: ['other'] })]);
    await db.exercises.put(makeExercise([QCM, VRAI_FAUX], { createdAt: Date.UTC(2026, 8, 14, 12) }));
    await db.answers.bulkPut([makeAnswer('q1', { verdict: 'correct' }), makeAnswer('q2', { verdict: 'incorrect' })]);

    await renderAt('/exercices', ROUTES);
    await waitForText('Choisis un livre');
    expect(text()).not.toContain('Livre d’un autre enfant');
    await waitForText('1 bonne réponse sur 2');
    expect(text()).toContain('14 septembre');

    await click(button('Le cycle de l’eau'));
    await waitForText('Que veux-tu faire ?');
    await clickButton('Résumé');
    expect(location()).toBe(`/exercices/${DOC_ID}/resume`);
  });

  it('opens a past exercise and invites to ask an adult when there is no book', async () => {
    await renderAt('/exercices', ROUTES);
    await waitForText('Pas encore de livre');
    await cleanup();

    await db.documents.put(makeDoc());
    await db.exercises.put(makeExercise([QCM]));
    await renderAt('/exercices', ROUTES);
    const past = await waitFor(() => document.querySelector<HTMLButtonElement>('.ex-past__item'));
    expect(past.getAttribute('aria-label')).toContain('Pas encore commencé');
    await click(past);
    expect(location()).toBe('/exercices/quiz/ex-1');
  });

  it('goes back to the start when no child is selected', async () => {
    useSessionStore.setState({ selectedChildId: null, children: [] });
    await renderAt('/exercices', ROUTES);
    await waitFor(() => location() === '/');
  });
});
