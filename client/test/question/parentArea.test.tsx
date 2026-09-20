// « Pose ta question » in the adult area: Options switch (§18.2.6) and « Questions posées » in Activité (§18.3).
import {
  DEFAULT_EXERCISE_PREFERENCES, DEFAULT_PARENT_SETTINGS, DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES,
  type ActivitySummary, type ChildProfile, type FreeQuestionLogEntry, type ParentSettings,
} from '@aide/shared';
import { act, type ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import { ToastProvider } from '../../src/design/components';
import { errors } from '../../src/i18n/fr/errors';
import { parent } from '../../src/i18n/fr/parent';
import { useSessionStore } from '../../src/state/session';
import { json, mockFetch } from '../ai/helpers';
import { buttonByText, cleanup, click, render, waitFor } from '../shell/render';

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  putSettings: vi.fn(),
  getWorkerStatus: vi.fn(),
  getActivity: vi.fn(),
  markAlertSeen: vi.fn(),
}));

vi.mock('../../src/api/settings', () => ({ getSettings: api.getSettings, putSettings: api.putSettings, getWorkerStatus: api.getWorkerStatus }));
// The free question history keeps the real wrapper (URL + schema validation) over a mocked fetch.
vi.mock('../../src/api/activity', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/api/activity')>();
  return { ...original, getActivity: api.getActivity, markAlertSeen: api.markAlertSeen };
});

const { getFreeQuestionHistory } = await import('../../src/api/activity');
const AISettingsPage = (await import('../../src/features/parent/AISettingsPage')).default;
const ActivityPage = (await import('../../src/features/parent/ActivityPage')).default;

const tq = parent.activity.questions;

const SUMMARY: ActivitySummary = { sessions: [], aiRequests: [], alerts: [], ocrIssues: [], budget: { monthToDateEur: 0, monthlyBudgetEur: 10, workerEstimateEur: 0 } };

function makeChild(id: string, firstName: string): ChildProfile {
  return {
    id, parentId: 'p1', firstName, age: 9, avatar: '🦊', readingLevel: 'intermediaire', explanationDifficulty: 'simple',
    reading: { ...DEFAULT_READING_PREFERENCES }, tts: { ...DEFAULT_TTS_PREFERENCES }, exercises: { ...DEFAULT_EXERCISE_PREFERENCES },
    createdAt: id === 'c1' ? 1 : 2, updatedAt: 1, deletedAt: null,
  };
}

function entry(patch: Partial<FreeQuestionLogEntry>): FreeQuestionLogEntry {
  return { id: 'q1', childId: 'c1', question: 'Pourquoi le ciel est bleu ?', outcome: 'answered', answer: null, createdAt: Date.UTC(2026, 8, 18, 10), ...patch };
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

async function renderRoute(element: ReactElement): Promise<HTMLElement> {
  const router = createMemoryRouter([{ path: '/parent/x', element: <ToastProvider>{element}</ToastProvider> }], { initialEntries: ['/parent/x'] });
  return render(<RouterProvider router={router} />);
}

function questionsSection(container: HTMLElement): HTMLElement {
  const heading = Array.from(container.querySelectorAll('h3')).find((h) => h.textContent === tq.title);
  const section = heading?.closest('section');
  if (!section) throw new Error('no « Questions posées » section');
  return section;
}

const realMarkParentLocked = useSessionStore.getState().markParentLocked;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  setOnline(true);
  useSessionStore.setState({
    ready: true, online: true, parentSettings: null, children: [makeChild('c1', 'Léa')], markParentLocked: realMarkParentLocked,
  });
  api.getActivity.mockResolvedValue(SUMMARY);
  api.getWorkerStatus.mockResolvedValue(null);
});

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

afterAll(() => {
  db.close();
});

describe('Options: « Questions libres »', () => {
  const freeSwitch = (container: HTMLElement): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]')).find((b) => b.textContent?.includes(parent.ai.features.freeQuestion));
  /** §27: the features one by one are in « Réglages avancés ». */
  const openAdvanced = async (container: HTMLElement): Promise<void> => {
    await waitFor(() => expect(buttonByText(parent.ai.advanced, container)).toBeTruthy());
    expect(freeSwitch(container)).toBeUndefined();
    await click(buttonByText(parent.ai.advanced, container));
  };

  it('shows the switch with the protections and saves the flag', async () => {
    api.getSettings.mockResolvedValue(DEFAULT_PARENT_SETTINGS);
    api.putSettings.mockImplementation(async (value: ParentSettings) => value);
    const container = await renderRoute(<AISettingsPage />);
    await openAdvanced(container);

    await waitFor(() => expect(freeSwitch(container)?.getAttribute('aria-checked')).toBe('true'));
    expect(freeSwitch(container)?.textContent).toContain(parent.ai.features.freeQuestionHint);
    for (const line of parent.ai.features.freeQuestionProtections) expect(container.textContent).toContain(line);

    await click(freeSwitch(container));
    expect(freeSwitch(container)?.getAttribute('aria-checked')).toBe('false');
    await click(buttonByText(parent.ai.save, container));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledTimes(1));
    expect(api.putSettings.mock.calls[0]?.[0]).toMatchObject({ ai: { features: { freeQuestion: false } } });
    await waitFor(() => expect(useSessionStore.getState().parentSettings?.ai.features.freeQuestion).toBe(false));
  });

  it('is on for settings saved before the switch existed, and greyed out when the AI is off', async () => {
    const legacy = structuredClone(DEFAULT_PARENT_SETTINGS);
    delete (legacy.ai.features as Partial<ParentSettings['ai']['features']>).freeQuestion;
    api.getSettings.mockResolvedValue(legacy);
    const container = await renderRoute(<AISettingsPage />);
    await openAdvanced(container);
    await waitFor(() => expect(freeSwitch(container)?.getAttribute('aria-checked')).toBe('true'));
    await cleanup();

    api.getSettings.mockResolvedValue({ ...DEFAULT_PARENT_SETTINGS, ai: { ...DEFAULT_PARENT_SETTINGS.ai, enabled: false } });
    const off = await renderRoute(<AISettingsPage />);
    await openAdvanced(off);
    await waitFor(() => expect(freeSwitch(off)?.disabled).toBe(true));
  });
});

describe('Activité: « Questions posées »', () => {
  it('lists the questions with date, outcome and an expandable answer', async () => {
    const { calls } = mockFetch(() => json({
      entries: [
        entry({ id: 'q1', outcome: 'answered', answer: 'La lumière du soleil se disperse.' }),
        entry({ id: 'q2', question: 'Question bloquée', outcome: 'blocked' }),
        entry({ id: 'q3', question: 'Je suis triste', outcome: 'adult_redirect' }),
        entry({ id: 'q4', question: 'Et la lune ?', outcome: 'unavailable' }),
      ],
    }));
    const container = await renderRoute(<ActivityPage />);
    await waitFor(() => expect(questionsSection(container).textContent).toContain('4 questions'));
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/activity/questions?childId=c1&limit=100' });

    const section = questionsSection(container);
    expect(section.textContent).toContain(tq.intro);
    const items = Array.from(section.querySelectorAll('li'));
    expect(items).toHaveLength(4);
    expect(items.map((li) => li.querySelector('.outcome-badge')?.textContent)).toEqual([
      tq.outcomes.answered, tq.outcomes.blocked, tq.outcomes.adult_redirect, tq.outcomes.unavailable,
    ]);
    expect(items[0]?.textContent).toContain('Pourquoi le ciel est bleu ?');
    expect(items[0]?.textContent).toContain('2026');
    const details = items[0]?.querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe(tq.showAnswer);
    expect(details?.textContent).toContain('La lumière du soleil se disperse.');
    expect(items[1]?.querySelector('details')).toBeNull();
    // A single child: no selector.
    expect(section.querySelector('select')).toBeNull();
  });

  it('lets the parent pick the child when there are several', async () => {
    useSessionStore.setState({ children: [makeChild('c1', 'Léa'), makeChild('c2', 'Tom')] });
    const { calls } = mockFetch((call) => json({
      entries: call.url.includes('childId=c2') ? [entry({ id: 't1', childId: 'c2', question: 'Question de Tom' })] : [],
    }));
    const container = await renderRoute(<ActivityPage />);
    await waitFor(() => expect(questionsSection(container).textContent).toContain(tq.empty));

    const select = questionsSection(container).querySelector('select');
    if (!select) throw new Error('no child selector');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, 'c2');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(questionsSection(container).textContent).toContain('Question de Tom'));
    expect(calls.map((c) => c.url)).toContain('/api/activity/questions?childId=c2&limit=100');
  });

  it('shows the error state with a retry, then the list', async () => {
    let n = 0;
    mockFetch(() => {
      n += 1;
      return n === 1 ? json({ entries: [{ nonsense: true }] }) : json({ entries: [] });
    });
    const container = await renderRoute(<ActivityPage />);
    await waitFor(() => expect(questionsSection(container).textContent).toContain(tq.loadFailed));
    expect(questionsSection(container).textContent).toContain(errors.codes.invalid_response);
    await click(buttonByText(tq.retry, questionsSection(container)));
    await waitFor(() => expect(questionsSection(container).textContent).toContain(tq.empty));
  });

  it('handles a locked adult area like the other parent requests', async () => {
    const markParentLocked = vi.fn(async () => undefined);
    useSessionStore.setState({ markParentLocked });
    mockFetch(() => json({ error: { code: 'parent_locked', message: 'Verrouillé' } }, 403));
    const container = await renderRoute(<ActivityPage />);
    await waitFor(() => expect(questionsSection(container).textContent).toContain(errors.codes.parent_locked));
    expect(markParentLocked).toHaveBeenCalled();
  });

  it('the API wrapper bounds the limit and rejects answers outside the contract', async () => {
    const { calls } = mockFetch(() => json({ entries: [] }));
    await expect(getFreeQuestionHistory('c 1', 500)).resolves.toEqual({ entries: [] });
    await getFreeQuestionHistory('c1', 0);
    expect(calls.map((c) => c.url)).toEqual(['/api/activity/questions?childId=c+1&limit=200', '/api/activity/questions?childId=c1&limit=1']);
    mockFetch(() => json({ entries: [entry({ outcome: 'unknown' as FreeQuestionLogEntry['outcome'] })] }));
    await expect(getFreeQuestionHistory('c1')).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
