import type { FreeQuestionLogEntry, Id } from '@aide/shared';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { FREE_QUESTION_HISTORY_LIMIT, getFreeQuestionHistory } from '../../api/activity';
import { Button, Field, Select, Spinner } from '../../design/components';
import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';
import { describeError, reportSessionError } from '../../state/errors';
import { useSessionStore } from '../../state/session';
import { formatDateTime } from './format';
import { ParentSection } from './ParentPage';

const t = parent.activity.questions;

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; entries: FreeQuestionLogEntry[] }
  | { status: 'error'; message: string };

export interface FreeQuestionsSectionProps {
  /** Child chosen in the page filter (null: « Tous les enfants »). */
  preferredChildId: Id | null;
  /** Changes when the parent presses « Actualiser ». */
  refreshToken: number;
}

/** « Questions posées » (§18.3): the free questions of one child over the last 30 days, with outcome and answer. */
export function FreeQuestionsSection({ preferredChildId, refreshToken }: FreeQuestionsSectionProps): JSX.Element {
  const children = useSessionStore((s) => s.children);
  const [selected, setSelected] = useState<Id | null>(preferredChildId);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [retry, setRetry] = useState(0);

  // Follow the page filter when it names a child.
  useEffect(() => {
    if (preferredChildId !== null) setSelected(preferredChildId);
  }, [preferredChildId]);

  const childId = selected !== null && children.some((c) => c.id === selected) ? selected : (children[0]?.id ?? null);

  const load = useCallback(async (id: Id, signal: AbortSignal): Promise<void> => {
    setState({ status: 'loading' });
    try {
      const history = await getFreeQuestionHistory(id, FREE_QUESTION_HISTORY_LIMIT, { signal });
      if (!signal.aborted) setState({ status: 'ready', entries: history.entries });
    } catch (error) {
      if (signal.aborted) return;
      // parent_locked: the layout asks for the PIN again, like the other parent requests.
      await reportSessionError(error);
      setState({ status: 'error', message: describeError(error) });
    }
  }, []);

  useEffect(() => {
    if (childId === null) return undefined;
    const controller = new AbortController();
    void load(childId, controller.signal);
    return () => controller.abort();
  }, [childId, load, refreshToken, retry]);

  const childOptions = children.map((c) => ({ value: c.id, label: c.nickname }));

  return (
    <ParentSection title={t.title} hint={t.intro}>
      {children.length > 1 && childId !== null && (
        <Field label={t.child} size="parent">
          <Select value={childId} options={childOptions} onChange={(e) => setSelected(e.target.value)} />
        </Field>
      )}
      {childId === null ? (
        <p className="parent-section__hint">{t.noChildren}</p>
      ) : state.status === 'loading' ? (
        <Spinner size="md" />
      ) : state.status === 'error' ? (
        <div className="stack stack--tight">
          <p className="form-error" role="alert">
            {t.loadFailed} {state.message}
          </p>
          <div className="parent-actions">
            <Button variant="secondary" size="parent" icon="🔄" onClick={() => setRetry((n) => n + 1)}>
              {t.retry}
            </Button>
          </div>
        </div>
      ) : state.entries.length === 0 ? (
        <p className="parent-section__hint">{t.empty}</p>
      ) : (
        <>
          <p className="parent-section__hint">
            {state.entries.length === 1 ? t.countOne : format(t.countMany, { count: state.entries.length })}
          </p>
          <ul className="parent-list">
            {state.entries.map((entry) => (
              <li key={entry.id} className="parent-list__item question-log">
                <span className="parent-list__main">
                  <span className="parent-list__meta">{formatDateTime(entry.createdAt)}</span>
                  <span className="parent-list__title">{entry.question}</span>
                  {entry.answer !== null && entry.answer.trim() !== '' && (
                    <details className="question-log__answer">
                      <summary>{t.showAnswer}</summary>
                      <p>{entry.answer}</p>
                    </details>
                  )}
                </span>
                <span className={`outcome-badge outcome-badge--${entry.outcome}`}>{t.outcomes[entry.outcome]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </ParentSection>
  );
}
