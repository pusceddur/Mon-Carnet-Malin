import type { ActivitySummary, Id } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router';
import { getActivity, markAlertSeen } from '../../api/activity';
import { db } from '../../db/localDb';
import { Button, EmptyState, Field, ProgressBar, Segmented, Select, Spinner, useToast } from '../../design/components';
import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';
import { describeError, reportSessionError } from '../../state/errors';
import { PATHS } from '../../state/guards';
import { useSessionStore } from '../../state/session';
import { computeActivityStats, periodRange, sortAlerts, type ActivityPeriod } from './activityStats';
import { formatDateTime, formatDuration, formatEuros } from './format';
import { FreeQuestionsSection } from './FreeQuestionsSection';
import { WritingCorrectionsSection } from './WritingCorrectionsSection';
import { ParentPage, ParentSection } from './ParentPage';

const t = parent.activity;
const ALL = 'all';

const periodOptions = (Object.keys(t.periods) as ActivityPeriod[]).map((value) => ({ value, label: t.periods[value] }));

function label(labels: Readonly<Record<string, string>>, key: string): string {
  return Object.prototype.hasOwnProperty.call(labels, key) ? (labels[key] ?? key) : key;
}

/** Reading statistics, AI usage and budget, alerts and OCR problems (phase 4). */
export default function ActivityPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const children = useSessionStore((s) => s.children);
  const [childId, setChildId] = useState<string>(ALL);
  const [period, setPeriod] = useState<ActivityPeriod>('week');
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [marking, setMarking] = useState<Id | null>(null);
  const [questionsRefresh, setQuestionsRefresh] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setFailed(null);
    try {
      const range = periodRange(period, Date.now());
      setSummary(await getActivity({ childId: childId === ALL ? undefined : childId, from: range.from, to: range.to }));
    } catch (error) {
      await reportSessionError(error);
      setFailed(describeError(error));
    } finally {
      setLoading(false);
    }
  }, [childId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const ocrDocumentIds = useMemo(() => Array.from(new Set(summary?.ocrIssues.map((i) => i.documentId) ?? [])), [summary]);
  const documentTitles = useLiveQuery(
    async () => {
      const docs = await db.documents.bulkGet(ocrDocumentIds);
      return new Map(docs.flatMap((d) => (d && d.deletedAt === null ? [[d.id, d.title] as const] : [])));
    },
    [ocrDocumentIds],
    new Map<Id, string>(),
  );

  const childName = (id: Id | null): string | null => (id === null ? null : (children.find((c) => c.id === id)?.firstName ?? null));
  const stats = summary ? computeActivityStats(summary) : null;

  const onMarkSeen = async (id: Id): Promise<void> => {
    setMarking(id);
    try {
      await markAlertSeen(id);
      const seenAt = Date.now();
      setSummary((s) => (s ? { ...s, alerts: s.alerts.map((a) => (a.id === id ? { ...a, seenAt } : a)) } : s));
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
    } finally {
      setMarking(null);
    }
  };

  const childOptions = [{ value: ALL, label: t.allChildren }, ...children.map((c) => ({ value: c.id, label: c.firstName }))];

  return (
    <ParentPage
      title={t.title}
      actions={
        <Button
          variant="secondary"
          size="parent"
          icon="🔄"
          loading={loading}
          onClick={() => {
            void load();
            setQuestionsRefresh((n) => n + 1);
          }}
        >
          {t.refresh}
        </Button>
      }
    >
      <div className="form-grid">
        <Field label={t.childFilter} size="parent">
          <Select value={childId} options={childOptions} onChange={(e) => setChildId(e.target.value)} />
        </Field>
        <Segmented label={t.period} size="parent" options={periodOptions} value={period} onChange={setPeriod} />
      </div>

      {failed && !summary ? (
        <EmptyState
          emoji="⚠️"
          title={t.loadFailed}
          message={failed}
          action={
            <Button variant="secondary" size="parent" onClick={() => void load()}>
              {t.refresh}
            </Button>
          }
        />
      ) : !summary || !stats ? (
        <Spinner size="lg" />
      ) : (
        <>
          {failed && <p className="form-error" role="alert">{failed}</p>}
          <div className="stat-grid">
            <div className="stat">
              <span className="stat__value">{formatDuration(stats.readingMs)}</span>
              <span className="stat__label">{t.stats.readingTime}</span>
            </div>
            <div className="stat">
              <span className="stat__value">{stats.pagesRead}</span>
              <span className="stat__label">{t.stats.pages}</span>
            </div>
            <div className="stat">
              <span className="stat__value">{stats.wordsLookedUp}</span>
              <span className="stat__label">{t.stats.words}</span>
            </div>
            <div className="stat">
              <span className="stat__value">{formatDuration(stats.ttsSeconds * 1000)}</span>
              <span className="stat__label">{t.stats.listening}</span>
            </div>
            <div className="stat">
              <span className="stat__value">{stats.sessionCount}</span>
              <span className="stat__label">{t.stats.sessions}</span>
            </div>
          </div>

          <ParentSection title={t.ai.title}>
            {stats.ai.total === 0 ? (
              <p className="parent-section__hint">{t.ai.none}</p>
            ) : (
              <>
                <p className="parent-page__intro">
                  {format(t.ai.total, { count: stats.ai.total })} · {format(t.ai.cacheHits, { count: stats.ai.cacheHits })}
                </p>
                <ul className="status-counts">
                  {stats.ai.byStatus.map((s) => (
                    <li key={s.status} className="status-count">
                      {format(t.ai.statusCount, { label: label(t.ai.statuses, s.status), count: s.count })}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </ParentSection>

          <ParentSection title={t.budget.title}>
            <ProgressBar
              label={t.budget.title}
              hideLabel
              value={stats.budget.budgetEur > 0 ? Math.min(stats.budget.totalEur, stats.budget.budgetEur) : stats.budget.percent}
              max={stats.budget.budgetEur > 0 ? stats.budget.budgetEur : 100}
              valueText={format(t.budget.value, { spent: formatEuros(stats.budget.totalEur), budget: formatEuros(stats.budget.budgetEur) })}
              tone={stats.budget.level === 'ok' && !stats.budget.estimateOver ? 'accent' : 'warm'}
            />
            {stats.budget.estimateEur > 0 && <p className="parent-section__hint">{format(t.budget.estimate, { amount: formatEuros(stats.budget.estimateEur) })}</p>}
            {stats.budget.level === 'warning' && <p className="form-notice">{t.budget.warning}</p>}
            {stats.budget.level === 'reached' && <p className="form-error">{t.budget.reached}</p>}
            {stats.budget.estimateOver && <p className="form-notice">{t.budget.estimateOver}</p>}
          </ParentSection>

          <ParentSection title={t.alerts.title}>
            {summary.alerts.length === 0 ? (
              <p className="parent-section__hint">{t.alerts.none}</p>
            ) : (
              <ul className="parent-list">
                {sortAlerts(summary.alerts).map((alert) => {
                  const name = childName(alert.childId);
                  return (
                    <li key={alert.id} className={`parent-list__item${alert.seenAt === null ? ' alert-item--unseen' : ''}`}>
                      <span className="parent-list__main">
                        <span className="parent-list__title">{label(t.alerts.kinds, alert.kind)}</span>
                        <span className="parent-list__meta">
                          {formatDateTime(alert.createdAt)}
                          {name ? ` · ${format(t.alerts.child, { prenom: name })}` : ''}
                        </span>
                        {alert.detail && <span className="parent-list__meta">{alert.detail}</span>}
                      </span>
                      {alert.seenAt === null ? (
                        <Button variant="secondary" size="parent" loading={marking === alert.id} onClick={() => void onMarkSeen(alert.id)}>
                          {t.alerts.markSeen}
                        </Button>
                      ) : (
                        <span className="tag">{t.alerts.seen}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </ParentSection>

          <ParentSection title={t.ocr.title}>
            {summary.ocrIssues.length === 0 ? (
              <p className="parent-section__hint">{t.ocr.none}</p>
            ) : (
              <ul className="parent-list">
                {summary.ocrIssues.map((issue) => {
                  const title = documentTitles.get(issue.documentId);
                  return (
                    <li key={`${issue.documentId}:${issue.pageIndex}`} className="parent-list__item">
                      <span className="parent-list__main">
                        <span className="parent-list__title">{title ?? t.ocr.unknownDocument}</span>
                        <span className="parent-list__meta">
                          {format(t.ocr.page, { page: issue.pageIndex + 1 })}
                          {issue.confidence !== null ? ` · ${format(t.ocr.confidence, { value: Math.round(issue.confidence) })}` : ''}
                        </span>
                        {issue.warnings.length > 0 && (
                          <span className="row">
                            {issue.warnings.map((w) => (
                              <span key={w} className="tag">
                                {label(t.ocr.warnings, w)}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      {title !== undefined && (
                        <Button
                          variant="secondary"
                          size="parent"
                          onClick={() => navigate(`${PATHS.parent}/documents/${encodeURIComponent(issue.documentId)}/pages/${issue.pageIndex}`)}
                        >
                          {t.ocr.open}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </ParentSection>
        </>
      )}

      {/* Loaded on its own: one child at a time, last 30 days (§18.3). */}
      <FreeQuestionsSection preferredChildId={childId === ALL ? null : childId} refreshToken={questionsRefresh} />
      {/* §24 texts corrected with « Corriger », one child at a time, the kept year. */}
      <WritingCorrectionsSection preferredChildId={childId === ALL ? null : childId} refreshToken={questionsRefresh} />
    </ParentPage>
  );
}
