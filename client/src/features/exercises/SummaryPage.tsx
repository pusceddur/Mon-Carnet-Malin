import { KID_MESSAGES, LIMITS, type ChildProfile, type DocumentMeta, type PageContent, type SummaryLevel } from '@aide/shared';
import { useMemo, useState, type JSX } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Button, EmptyState, ProgressBar, Segmented } from '../../design/components';
import { readingFontClass } from '../../design/reading';
import { format } from '../../i18n/fr';
import { exercises as t } from '../../i18n/fr/exercises';
import { ChildGate } from './components/ChildGate';
import { ListenButton, Notice, SourceLinks, useStopSpeechOnUnmount } from './components/common';
import { DocumentGate } from './components/DocumentGate';
import { ExerciseLayout } from './components/ExerciseLayout';
import { PageRangePicker } from './components/PageRangePicker';
import { useAbortable, useParentSettings } from './hooks';
import { aiFeatureEnabled } from './lib/aiResults';
import { initialSelection, selectPages, toAIPageInputs, type PageSelection } from './lib/documentPages';
import { exercisesHomeLink } from './lib/links';
import { buildSummary, type SummaryOutcome } from './lib/summary';

const TITLE = `${t.summary.emoji} ${t.summary.title}`;
const LEVELS: readonly SummaryLevel[] = ['bref', 'normal', 'detaille'];

type Phase =
  | { kind: 'setup' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'result'; outcome: Exclude<SummaryOutcome, { kind: 'aborted' }>; truncated: boolean };

export default function SummaryPage(): JSX.Element {
  const { documentId } = useParams();
  return (
    <ChildGate>
      {(child) => (
        <DocumentGate documentId={documentId} childId={child.id} title={TITLE}>
          {(doc, pages) => <SummaryScreen child={child} doc={doc} pages={pages} />}
        </DocumentGate>
      )}
    </ChildGate>
  );
}

function SummaryScreen({ child, doc, pages }: { child: ChildProfile; doc: DocumentMeta; pages: PageContent[] }): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const settings = useParentSettings();
  const pageCount = Math.max(doc.pageCount, pages.length);
  const [level, setLevel] = useState<SummaryLevel>('normal');
  const [selection, setSelection] = useState<PageSelection>(() => initialSelection(pageCount, params.get('page')));
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const { start, abort } = useAbortable();
  useStopSpeechOnUnmount();

  const stats = useMemo(() => selectPages(pages, selection, pageCount), [pages, selection, pageCount]);

  const run = async (): Promise<void> => {
    const signal = start();
    setPhase({ kind: 'running', done: 0, total: 0 });
    try {
      // Chunks are sent one by one, so the summary accepts far more text than a single request.
      const { inputs, truncated } = await toAIPageInputs(stats.readable, LIMITS.chunkMaxChars * LIMITS.summarizeMaxChunks);
      if (signal.aborted) return;
      const outcome = await buildSummary({
        childId: child.id,
        documentId: doc.id,
        documentHash: doc.sourceHash || null,
        level,
        pages: inputs,
        aiAllowed: aiFeatureEnabled(settings, 'summarize'),
        onProgress: (done, total) => {
          if (!signal.aborted) setPhase({ kind: 'running', done, total });
        },
        signal,
      });
      if (signal.aborted || outcome.kind === 'aborted') return;
      setPhase({ kind: 'result', outcome, truncated });
    } catch {
      if (!signal.aborted) setPhase({ kind: 'result', outcome: { kind: 'unavailable', message: null }, truncated: false });
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
            <Segmented<SummaryLevel>
              label={t.summary.levelLabel}
              value={level}
              onChange={setLevel}
              options={LEVELS.map((value) => ({ value, label: t.summary.levels[value] }))}
            />
          </section>
          <PageRangePicker
            pageCount={pageCount}
            selection={selection}
            onChange={setSelection}
            readableCount={stats.readable.length}
            notReadyCount={stats.notReady}
          />
          <div className="ex-actions">
            <Button icon={t.summary.emoji} onClick={() => void run()} disabled={stats.readable.length === 0}>
              {t.summary.start}
            </Button>
          </div>
        </>
      )}

      {phase.kind === 'running' && (
        <section className="ex-card ex-stack" aria-live="polite">
          <ProgressBar
            label={t.summary.progressLabel}
            value={phase.total > 0 ? phase.done : null}
            max={Math.max(1, phase.total)}
            valueText={phase.total > 0 ? format(t.summary.progressValue, { done: phase.done, total: phase.total }) : undefined}
          />
          <p className="ex-muted">{t.summary.preparing}</p>
          <div>
            <Button variant="ghost" onClick={stop}>
              {t.common.stop}
            </Button>
          </div>
        </section>
      )}

      {phase.kind === 'result' && (
        <SummaryResult
          child={child}
          doc={doc}
          outcome={phase.outcome}
          truncated={phase.truncated}
          onAgain={() => setPhase({ kind: 'setup' })}
          onBack={() => navigate(exercisesHomeLink(doc.id))}
        />
      )}
    </ExerciseLayout>
  );
}

function SummaryResult({ child, doc, outcome, truncated, onAgain, onBack }: {
  child: ChildProfile;
  doc: DocumentMeta;
  outcome: Exclude<SummaryOutcome, { kind: 'aborted' }>;
  truncated: boolean;
  onAgain: () => void;
  onBack: () => void;
}): JSX.Element {
  if (outcome.kind === 'blocked') {
    return (
      <EmptyState emoji="💛" title={t.summary.blockedTitle} message={outcome.message} action={<Button onClick={onBack}>{t.summary.backToBook}</Button>} />
    );
  }
  if (outcome.kind === 'unavailable') {
    return (
      <EmptyState
        emoji="🌙"
        title={t.summary.unavailableTitle}
        message={outcome.message ?? t.summary.emptyText}
        action={<Button onClick={onAgain}>{t.summary.again}</Button>}
      />
    );
  }

  const { data } = outcome;
  const paragraphs = data.summary.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
  const keyPoints = data.keyPoints.filter((k) => k.trim().length > 0);
  const spoken = [...paragraphs, ...keyPoints].join('\n');

  return (
    <>
      <section className="ex-card ex-stack" aria-labelledby="ex-summary-title">
        <div className="ex-row ex-row--between">
          <h2 id="ex-summary-title" className="ex-section-title">
            {t.summary.resultTitle}
          </h2>
          <ListenButton text={spoken} label={t.summary.listenSummary} />
        </div>
        {outcome.origin === 'local' && <p className="ex-badge">{t.summary.localLabel}</p>}
        {outcome.sourceWarning && <Notice tone="warn">{KID_MESSAGES.sourceWarning}</Notice>}
        {truncated && <Notice>{t.common.longText}</Notice>}
        <div className={`ex-reading ${readingFontClass(child.reading.font)}`}>
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </section>

      {keyPoints.length > 0 && (
        <section className="ex-card ex-stack" aria-labelledby="ex-keypoints">
          <h2 id="ex-keypoints" className="ex-section-title">
            {t.summary.keyPointsTitle}
          </h2>
          <ul className={`ex-keypoints ${readingFontClass(child.reading.font)}`}>
            {keyPoints.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </section>
      )}

      {data.sourceRefs.length > 0 && (
        <section className="ex-card ex-stack" aria-labelledby="ex-sources">
          <h2 id="ex-sources" className="ex-section-title">
            {t.summary.sourcesTitle}
          </h2>
          <SourceLinks documentId={doc.id} refs={data.sourceRefs} />
        </section>
      )}

      <div className="ex-actions">
        <Button variant="secondary" onClick={onAgain}>
          {t.summary.again}
        </Button>
      </div>
    </>
  );
}
