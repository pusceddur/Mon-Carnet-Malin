// « Pose ta question » (§18.4): home tile gating and the question page flow with a mocked AI client.
import {
  DEFAULT_EXERCISE_PREFERENCES, DEFAULT_PARENT_SETTINGS, DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES, KID_MESSAGES, LIMITS, PROMPT_VERSION,
  type AIMeta, type AIResult, type AuthStatus, type ChildProfile, type FreeQuestionData, type ParentSettings,
} from '@aide/shared';
import { act } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { home } from '../../src/i18n/fr/home';
import { question as q } from '../../src/i18n/fr/question';
import { useSessionStore } from '../../src/state/session';
import { buttonByText, cleanup, click, render, waitFor } from '../shell/render';

const mocks = vi.hoisted(() => ({
  requestAI: vi.fn(),
  speakOnce: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('../../src/ai/aiClient', () => ({ requestAI: mocks.requestAI }));
vi.mock('../../src/tts/SpeechEngine', () => ({
  SpeechEngine: { isSupported: () => true },
  speechEngine: { speakOnce: mocks.speakOnce, stop: mocks.stop, setVoice: vi.fn(), setRate: vi.fn(), setPitch: vi.fn() },
}));

const ChildHome = (await import('../../src/features/home/ChildHome')).default;
const QuestionPage = (await import('../../src/features/question/QuestionPage')).default;

const META: AIMeta = { cached: false, route: 'light', promptVersion: PROMPT_VERSION, sourceWarning: false, requestId: 'r1' };
const QUESTION = 'Pourquoi le ciel est bleu ?';

function status(): AuthStatus {
  return {
    setupRequired: false, authenticated: true, parent: { id: 'p1', email: 'parent@example.org', displayName: 'Parent', createdAt: 1, isOwner: true },
    parentUnlockedUntil: null, pinSet: true, pinLockedUntil: null, registrationOpen: false, pinRequired: true, passwordResetAvailable: false, aiReading: false,
  };
}

function makeChild(): ChildProfile {
  return {
    id: 'c1', parentId: 'p1', firstName: 'Léa', age: 9, avatar: '🦊', readingLevel: 'intermediaire', explanationDifficulty: 'simple',
    reading: { ...DEFAULT_READING_PREFERENCES, font: 'opendyslexic', fontSizePx: 28 },
    tts: { ...DEFAULT_TTS_PREFERENCES }, exercises: { ...DEFAULT_EXERCISE_PREFERENCES },
    createdAt: 1, updatedAt: 1, deletedAt: null,
  };
}

function settingsWith(ai: Partial<ParentSettings['ai']>, features: Partial<ParentSettings['ai']['features']> = {}): ParentSettings {
  return { ...DEFAULT_PARENT_SETTINGS, ai: { ...DEFAULT_PARENT_SETTINGS.ai, ...ai, features: { ...DEFAULT_PARENT_SETTINGS.ai.features, ...features } } };
}

function ok(data: Partial<FreeQuestionData> = {}): AIResult<FreeQuestionData> {
  return {
    status: 'ok',
    data: { answer: 'La lumière du soleil se disperse dans l’air.', example: 'Comme un arc-en-ciel.', suggestions: [], ...data },
    meta: META,
  };
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

function setSession(parentSettings: ParentSettings | null = null): void {
  useSessionStore.setState({ ready: true, online: true, refreshing: false, authStatus: status(), children: [makeChild()], selectedChildId: 'c1', parentSettings });
}

async function renderAt(path: string) {
  const router = createMemoryRouter([
    { path: '/accueil', element: <ChildHome /> },
    { path: '/question', element: <QuestionPage /> },
  ], { initialEntries: [path] });
  const container = await render(<RouterProvider router={router} />);
  return { router, container };
}

function field(): HTMLTextAreaElement {
  const el = document.querySelector('textarea');
  if (!el) throw new Error('no textarea');
  return el;
}

async function typeQuestion(value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(field(), value);
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function text(): string {
  return document.body.textContent ?? '';
}

function tile(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button.ui-tile')).find((b) => b.textContent?.includes(home.tiles.question));
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.clearAllMocks();
  setOnline(true);
  setSession();
});

afterEach(async () => {
  await cleanup();
});

afterAll(() => {
  db.close();
});

describe('child home tile « Pose ta question »', () => {
  it('is shown with the default settings and opens /question', async () => {
    const { router } = await renderAt('/accueil');
    expect(tile()).toBeDefined();
    expect(tile()?.disabled).toBe(false);
    expect(tile()?.textContent).toContain('🙋');
    await click(tile());
    expect(router.state.location.pathname).toBe('/question');
  });

  it('is hidden when the parent turned the free questions or the whole AI off', async () => {
    setSession(settingsWith({}, { freeQuestion: false }));
    await renderAt('/accueil');
    expect(text()).toContain(home.tiles.notes);
    expect(tile()).toBeUndefined();
    await cleanup();

    setSession(settingsWith({ enabled: false }));
    await renderAt('/accueil');
    expect(tile()).toBeUndefined();
  });

  it('is disabled offline, with the reason on the tile', async () => {
    setOnline(false);
    await renderAt('/accueil');
    expect(tile()?.disabled).toBe(true);
    expect(tile()?.textContent).toContain(home.questionOffline);
  });
});

describe('question page', () => {
  it('asks, waits calmly, then shows the answer in the child’s reading style, focused and readable aloud', async () => {
    let finish: (value: AIResult<FreeQuestionData>) => void = () => undefined;
    mocks.requestAI.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve;
    }));
    await renderAt('/question');
    const submit = buttonByText(q.form.submit);
    expect(submit?.disabled).toBe(true);

    await typeQuestion(`  ${QUESTION}\n`);
    expect(text()).toContain(`${QUESTION.length} / ${LIMITS.freeQuestionMaxChars}`);
    expect(buttonByText(q.form.submit)?.disabled).toBe(false);
    await click(buttonByText(q.form.submit));

    expect(mocks.requestAI).toHaveBeenCalledWith(
      'free_question',
      { childId: 'c1', documentId: null, documentHash: null, question: QUESTION, previous: null, mode: 'normal' },
      { signal: expect.any(AbortSignal) },
    );
    await waitFor(() => expect(text()).toContain(q.waiting.normal));
    expect(document.querySelector('.question-result')?.getAttribute('aria-live')).toBe('polite');

    await act(async () => {
      finish(ok());
    });
    await waitFor(() => expect(text()).toContain('La lumière du soleil se disperse dans l’air.'));
    expect(text()).toContain('Comme un arc-en-ciel.');
    const answer = document.querySelector<HTMLElement>('.question-answer__text');
    expect(answer?.classList.contains('reading')).toBe(true);
    expect(answer?.classList.contains('read-font-opendyslexic')).toBe(true);
    expect(answer?.style.getPropertyValue('--read-size')).toBe('28px');
    await waitFor(() => expect(document.activeElement?.textContent).toBe(q.answer.title));

    await click(buttonByText(q.answer.listenLabel));
    expect(mocks.speakOnce).toHaveBeenCalledWith('La lumière du soleil se disperse dans l’air.\nComme un arc-en-ciel.');

    await click(buttonByText(q.answer.newQuestion));
    expect(field().value).toBe('');
    expect(document.activeElement).toBe(field());
    expect(text()).not.toContain('La lumière du soleil');
  });

  it('« Je n’ai pas compris » asks again, simpler, with the previous exchange; a suggestion is asked as a follow-up', async () => {
    mocks.requestAI
      .mockResolvedValueOnce(ok({ answer: 'Réponse longue.' }))
      .mockResolvedValueOnce(ok({ answer: 'Réponse simple.', example: null, suggestions: ['Pourquoi le soleil est jaune ?', 'Et la mer ?'] }))
      .mockResolvedValueOnce(ok({ answer: 'Le soleil est une étoile.' }));
    await renderAt('/question');
    await typeQuestion(QUESTION);
    await click(buttonByText(q.form.submit));
    await waitFor(() => expect(text()).toContain('Réponse longue.'));

    await click(buttonByText(q.answer.notUnderstood));
    await waitFor(() => expect(text()).toContain('Réponse simple.'));
    expect(mocks.requestAI.mock.calls[1]?.[1]).toEqual({
      childId: 'c1', documentId: null, documentHash: null, question: QUESTION,
      previous: { question: QUESTION, answer: 'Réponse longue.' }, mode: 'simpler',
    });

    const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.question-chip'));
    expect(chips.map((c) => c.textContent)).toEqual(['💬Pourquoi le soleil est jaune ?', '💬Et la mer ?']);
    await click(chips[0]);
    await waitFor(() => expect(text()).toContain('Le soleil est une étoile.'));
    expect(mocks.requestAI.mock.calls[2]?.[1]).toEqual({
      childId: 'c1', documentId: null, documentHash: null, question: 'Pourquoi le soleil est jaune ?',
      previous: { question: QUESTION, answer: 'Réponse simple.' }, mode: 'normal',
    });
  });

  it('shows the blocked message calmly, without retry', async () => {
    mocks.requestAI.mockResolvedValueOnce({ status: 'blocked', reason: 'safety_input', message: KID_MESSAGES.questionBlocked, meta: META });
    await renderAt('/question');
    await typeQuestion('Une question pas adaptée');
    await click(buttonByText(q.form.submit));
    await waitFor(() => expect(text()).toContain(KID_MESSAGES.questionBlocked));
    expect(document.activeElement?.textContent).toBe(KID_MESSAGES.questionBlocked);
    expect(buttonByText(q.message.retry)).toBeNull();
    await click(buttonByText(q.message.listenLabel));
    expect(mocks.speakOnce).toHaveBeenCalledWith(KID_MESSAGES.questionBlocked);
    await click(buttonByText(q.message.newQuestion));
    expect(field().value).toBe('');
  });

  it('shows the 💛 adult message for a difficult subject, without retry', async () => {
    mocks.requestAI.mockResolvedValueOnce({ status: 'blocked', reason: 'adult_redirect', message: '', meta: META });
    await renderAt('/question');
    await typeQuestion('Je suis très triste');
    await click(buttonByText(q.form.submit));
    await waitFor(() => expect(text()).toContain(KID_MESSAGES.questionAdultRedirect));
    expect(document.querySelector('.question-message--adult_redirect')?.textContent).toContain('💛');
    expect(buttonByText(q.message.retry)).toBeNull();
    expect(buttonByText(q.message.newQuestion)).not.toBeNull();
  });

  it('offers to retry when the help is unavailable for a while, with the same request', async () => {
    mocks.requestAI
      .mockResolvedValueOnce({ status: 'unavailable', reason: 'busy', message: KID_MESSAGES.unavailable, meta: null })
      .mockResolvedValueOnce(ok({ answer: 'Voilà.' }));
    await renderAt('/question');
    await typeQuestion(QUESTION);
    await click(buttonByText(q.form.submit));
    await waitFor(() => expect(text()).toContain(KID_MESSAGES.unavailable));
    await click(buttonByText(q.message.retry));
    await waitFor(() => expect(text()).toContain('Voilà.'));
    expect(mocks.requestAI.mock.calls[1]?.[1]).toEqual(mocks.requestAI.mock.calls[0]?.[1]);
  });

  it('shows the offline message when the connection drops during the request', async () => {
    mocks.requestAI.mockResolvedValueOnce({ status: 'unavailable', reason: 'offline', message: KID_MESSAGES.offline, meta: null });
    await renderAt('/question');
    await typeQuestion(QUESTION);
    await click(buttonByText(q.form.submit));
    await waitFor(() => expect(text()).toContain(q.message.offline));
  });

  it('is disabled offline, with the reason, and never calls the AI', async () => {
    setOnline(false);
    await renderAt('/question');
    await typeQuestion(QUESTION);
    expect(text()).toContain(q.form.offline);
    expect(buttonByText(q.form.submit)?.disabled).toBe(true);
    await act(async () => {
      field().form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(mocks.requestAI).not.toHaveBeenCalled();
  });

  it('refuses a question over the limit and says so', async () => {
    await renderAt('/question');
    await typeQuestion('a'.repeat(LIMITS.freeQuestionMaxChars + 1));
    expect(text()).toContain(q.form.tooLong);
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(buttonByText(q.form.submit)?.disabled).toBe(true);
  });

  it('explains that questions are off when the parent disabled them, and goes back home', async () => {
    setSession(settingsWith({}, { freeQuestion: false }));
    const { router } = await renderAt('/question');
    expect(text()).toContain(q.disabled.title);
    expect(document.querySelector('textarea')).toBeNull();
    await click(buttonByText(q.disabled.home));
    expect(router.state.location.pathname).toBe('/accueil');
  });
});
