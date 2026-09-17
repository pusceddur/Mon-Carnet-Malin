import { LIMITS, type ChildProfile, type DocumentMeta, type PageContent, type QuestionType } from '@aide/shared';
import { useMemo, useState, type JSX } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Button, EmptyState, Segmented, useToast } from '../../design/components';
import { exercises as t } from '../../i18n/fr/exercises';
import { ChildGate } from './components/ChildGate';
import { Notice, WaitingPanel } from './components/common';
import { DocumentGate } from './components/DocumentGate';
import { ExerciseLayout } from './components/ExerciseLayout';
import { PageRangePicker } from './components/PageRangePicker';
import { useAbortable, useParentSettings } from './hooks';
import { aiFeatureEnabled } from './lib/aiResults';
import { initialSelection, selectionChars, selectPages, toAIPageInputs, type PageSelection } from './lib/documentPages';
import { createExercise, profileQuestionTypes, QUESTION_COUNTS, type QuestionCount } from './lib/generation';
import { exercisesHomeLink, quizLink } from './lib/links';

const TITLE = `${t.setup.emoji} ${t.setup.title}`;

type Phase = { kind: 'setup' } | { kind: 'waiting' } | { kind: 'blocked'; message: string } | { kind: 'empty' };

export default function QuizSetupPage(): JSX.Element {
  const { documentId } = useParams();
  return (
    <ChildGate>
      {(child) => (
        <DocumentGate documentId={documentId} childId={child.id} title={TITLE}>
          {(doc, pages) => <QuizSetupScreen child={child} doc={doc} pages={pages} />}
        </DocumentGate>
      )}
    </ChildGate>
  );
}

function QuizSetupScreen({ child, doc, pages }: { child: ChildProfile; doc: DocumentMeta; pages: PageContent[] }): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const settings = useParentSettings();
  const toast = useToast();
  const pageCount = Math.max(doc.pageCount, pages.length);
  const allowedTypes = useMemo(() => profileQuestionTypes(child.exercises.enabledTypes), [child.exercises.enabledTypes]);

  const [count, setCount] = useState<QuestionCount>(
    QUESTION_COUNTS.includes(child.exercises.defaultQuestionCount) ? child.exercises.defaultQuestionCount : 5,
  );
  const [types, setTypes] = useState<QuestionType[]>(allowedTypes);
  const [selection, setSelection] = useState<PageSelection>(() => initialSelection(pageCount, params.get('page')));
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const { start, abort } = useAbortable();

  const stats = useMemo(() => selectPages(pages, selection, pageCount), [pages, selection, pageCount]);
  const tooLong = useMemo(() => selectionChars(stats.readable) > LIMITS.pagesMaxTotalChars, [stats.readable]);
  const activeTypes = allowedTypes.filter((type) => types.includes(type));

  const toggleType = (type: QuestionType): void => {
    setTypes((current) => {
      if (!current.includes(type)) return [...current, type];
      const next = current.filter((other) => other !== type);
      return next.some((other) => allowedTypes.includes(other)) ? next : current;
    });
  };

  const generate = async (): Promise<void> => {
    const signal = start();
    setPhase({ kind: 'waiting' });
    try {
      const { inputs } = await toAIPageInputs(stats.readable);
      if (signal.aborted) return;
      const outcome = await createExercise({
        childId: child.id,
        documentId: doc.id,
        documentHash: doc.sourceHash || null,
        pages: inputs,
        count,
        types: activeTypes,
        aiAllowed: aiFeatureEnabled(settings, 'questions'),
        signal,
      });
      if (signal.aborted || outcome.kind === 'aborted') return;
      if (outcome.kind === 'ok') navigate(quizLink(outcome.exercise.id), { replace: true });
      else if (outcome.kind === 'blocked') setPhase({ kind: 'blocked', message: outcome.message });
      else setPhase({ kind: 'empty' });
    } catch {
      if (signal.aborted) return;
      toast.error(t.common.saveError);
      setPhase({ kind: 'setup' });
    }
  };

  const stop = (): void => {
    abort();
    setPhase({ kind: 'setup' });
  };

  const back = (): void => {
    if (phase.kind === 'setup') void navigate(exercisesHomeLink(doc.id));
    else stop();
  };

  return (
    <ExerciseLayout title={TITLE} subtitle={doc.title} onBack={back}>
      {phase.kind === 'setup' && (
        <>
          <section className="ex-card">
            <Segmented<`${QuestionCount}`>
              label={t.setup.countLabel}
              value={`${count}`}
              onChange={(value) => setCount(Number(value) as QuestionCount)}
              options={QUESTION_COUNTS.map((value) => ({ value: `${value}` as const, label: String(value) }))}
            />
          </section>

          {allowedTypes.length > 1 && (
            <section className="ex-card ex-stack" aria-labelledby="ex-types">
              <h2 id="ex-types" className="ex-field-title">
                {t.setup.typesLabel}
              </h2>
              <p className="ex-muted">{t.setup.typesHint}</p>
              <div className="ex-chips">
                {allowedTypes.map((type) => {
                  const on = types.includes(type);
                  return (
                    <button key={type} type="button" className="ex-chip" aria-pressed={on} onClick={() => toggleType(type)}>
                      <span aria-hidden="true">{on ? '✔️' : t.setup.typeEmoji[type]}</span>
                      <span>{t.setup.types[type]}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <PageRangePicker
            pageCount={pageCount}
            selection={selection}
            onChange={setSelection}
            readableCount={stats.readable.length}
            notReadyCount={stats.notReady}
          />
          {tooLong && <Notice>{t.common.longText}</Notice>}
          <div className="ex-actions">
            <Button icon="🚀" onClick={() => void generate()} disabled={stats.readable.length === 0 || activeTypes.length === 0}>
              {t.setup.start}
            </Button>
          </div>
        </>
      )}

      {phase.kind === 'waiting' && <WaitingPanel title={t.setup.waitingTitle} steps={t.setup.waitingSteps} onStop={stop} stopLabel={t.setup.stop} />}

      {phase.kind === 'blocked' && (
        <EmptyState
          emoji="💛"
          title={t.setup.blockedTitle}
          message={phase.message}
          action={<Button onClick={() => navigate(exercisesHomeLink(doc.id))}>{t.summary.backToBook}</Button>}
        />
      )}

      {phase.kind === 'empty' && (
        <EmptyState
          emoji="🌱"
          title={t.setup.emptyTitle}
          message={t.setup.emptyText}
          action={<Button onClick={() => setPhase({ kind: 'setup' })}>{t.setup.tryAgain}</Button>}
        />
      )}
    </ExerciseLayout>
  );
}
