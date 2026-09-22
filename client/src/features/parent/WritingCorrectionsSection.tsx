// §24 « Écriture corrigée »: the texts the child corrected with « Corriger », what changed and the mistakes made again, so
// that the adult can work on writing with the child.
import type { Id, WritingChangeKind, WritingCorrectionEntry, WritingCorrectionHistory } from '@aide/shared';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { getWritingCorrectionHistory } from '../../api/activity';
import { Button, Field, Select, Spinner } from '../../design/components';
import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';
import { describeError, reportSessionError } from '../../state/errors';
import { useSessionStore } from '../../state/session';
import { formatDateTime } from './format';
import { ParentSection } from './ParentPage';

const t = parent.activity.writing;
const KIND_ORDER: readonly WritingChangeKind[] = ['orthographe', 'accent', 'grammaire', 'espace', 'ponctuation', 'majuscule'];

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; history: WritingCorrectionHistory }
  | { status: 'error'; message: string };

export interface WritingCorrectionsSectionProps {
  /** Child chosen in the page filter (null: « Tous les enfants »). */
  preferredChildId: Id | null;
  /** Changes when the parent presses « Actualiser ». */
  refreshToken: number;
}

function CorrectionEntry({ entry }: { entry: WritingCorrectionEntry }): JSX.Element {
  const count = entry.changes.length;
  return (
    <li className="parent-list__item writing-log">
      <span className="parent-list__main">
        <span className="parent-list__meta">
          {formatDateTime(entry.createdAt)} · {count === 0 ? t.noFault : count === 1 ? t.correctionsOne : format(t.correctionsMany, { count })}
        </span>
        {count > 0 && (
          <ul className="writing-log__changes">
            {entry.changes.map((change, index) => (
              <li key={`${change.line}-${index}`} className="writing-log__change">
                <del className="writing-log__from">{change.from || '∅'}</del>
                <span aria-hidden="true"> → </span>
                <ins className="writing-log__to">{change.to || '∅'}</ins>
                <span className={`writing-kind writing-kind--${change.kind}`}>{t.kinds[change.kind]}</span>
                {change.rule && <span className="writing-log__rule">{change.rule}</span>}
              </li>
            ))}
          </ul>
        )}
        <details className="writing-log__texts">
          <summary>{t.showTexts}</summary>
          <p className="writing-log__label">{t.original}</p>
          <p className="writing-log__text">{entry.originalText}</p>
          <p className="writing-log__label">{t.corrected}</p>
          <p className="writing-log__text">{entry.correctedText}</p>
        </details>
      </span>
    </li>
  );
}

/** One child at a time, the kept year: count per kind, frequent mistakes, then each corrected text. */
export function WritingCorrectionsSection({ preferredChildId, refreshToken }: WritingCorrectionsSectionProps): JSX.Element {
  const children = useSessionStore((s) => s.children);
  const [selected, setSelected] = useState<Id | null>(preferredChildId);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (preferredChildId !== null) setSelected(preferredChildId);
  }, [preferredChildId]);

  const childId = selected !== null && children.some((c) => c.id === selected) ? selected : (children[0]?.id ?? null);

  const load = useCallback(async (id: Id, signal: AbortSignal): Promise<void> => {
    setState({ status: 'loading' });
    try {
      const history = await getWritingCorrectionHistory(id, { signal });
      if (!signal.aborted) setState({ status: 'ready', history });
    } catch (error) {
      if (signal.aborted) return;
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
      ) : state.history.entries.length === 0 ? (
        <p className="parent-section__hint">{t.empty}</p>
      ) : (
        <>
          <div className="stack stack--tight">
            <p className="writing-log__label">{t.summaryTitle}</p>
            <ul className="writing-summary">
              {KIND_ORDER.filter((k) => state.history.counts[k] > 0).map((k) => (
                <li key={k} className={`writing-kind writing-kind--${k}`}>
                  {t.kinds[k]} : {state.history.counts[k]}
                </li>
              ))}
            </ul>
          </div>
          {state.history.frequent.length > 0 && (
            <div className="stack stack--tight">
              <p className="writing-log__label">{t.frequentTitle}</p>
              <ul className="writing-log__changes">
                {state.history.frequent.map((m) => (
                  <li key={`${m.from}→${m.to}`} className="writing-log__change">
                    <del className="writing-log__from">{m.from}</del>
                    <span aria-hidden="true"> → </span>
                    <ins className="writing-log__to">{m.to}</ins>
                    <span className="writing-log__rule">{format(t.frequentItem, { count: m.count })}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="parent-list">
            {state.history.entries.map((entry) => (
              <CorrectionEntry key={entry.id} entry={entry} />
            ))}
          </ul>
        </>
      )}
    </ParentSection>
  );
}
