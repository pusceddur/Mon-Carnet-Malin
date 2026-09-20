import type { ParentSettings, SafetyLevel, WorkerStatus } from '@aide/shared';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Link } from 'react-router';
import { getSettings, getWorkerStatus, putSettings } from '../../api/settings';
import { Button, EmptyState, Segmented, Slider, Spinner, Toggle, useToast } from '../../design/components';
import { format } from '../../i18n/fr';
import { documents } from '../../i18n/fr/documents';
import { parent } from '../../i18n/fr/parent';
import { describeError, reportSessionError } from '../../state/errors';
import { useSessionStore } from '../../state/session';
import { AdvancedSettings } from './AdvancedSettings';
import { ParentPage, ParentSection } from './ParentPage';
import { completeSettings, sameSettings } from './settingsModel';
import { describeWorkerStatus } from './workerStatus';

const t = parent.ai;

type AiSettings = ParentSettings['ai'];
type Features = AiSettings['features'];

const FEATURE_ROWS: { key: keyof Features; label: string; hint?: string }[] = [
  { key: 'explainWord', label: t.features.explainWord, hint: t.features.explainWordHint },
  { key: 'explainText', label: t.features.explainText },
  { key: 'simplify', label: t.features.simplify },
  { key: 'summarize', label: t.features.summarize },
  { key: 'questions', label: t.features.questions },
  { key: 'correctAnswers', label: t.features.correctAnswers, hint: t.features.correctAnswersHint },
  { key: 'questionOnText', label: t.features.questionOnText, hint: t.features.questionOnTextHint },
  { key: 'correctWriting', label: t.features.correctWriting, hint: t.features.correctWritingHint },
];

const safetyOptions = (Object.keys(t.safetyLevels) as SafetyLevel[]).map((value) => ({ value, label: t.safetyLevels[value] }));

/** §21: the use of the subscription is followed while the page is on screen. */
export const WORKER_STATUS_REFRESH_MS = 30_000;

/**
 * State of the home computer (« lecture intelligente ») and use of the subscription (§21), fetched when the page opens,
 * every 30 s while it is visible and on « Actualiser ».
 */
function WorkerStatusPanel(): JSX.Element {
  // undefined: first check running; null: unknown (offline, error).
  const [status, setStatus] = useState<{ value: WorkerStatus | null; checkedAt: number } | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async (quiet = false): Promise<void> => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!quiet) setLoading(true);
    const value = await getWorkerStatus(controller.signal);
    if (controller.signal.aborted) return;
    // A failed background check keeps the last figures on screen.
    setStatus((previous) => (quiet && value === null && previous?.value ? previous : { value, checkedAt: Date.now() }));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true);
    }, WORKER_STATUS_REFRESH_MS);
    return () => {
      clearInterval(timer);
      request.current?.abort();
    };
  }, [refresh]);

  const view = status?.value ? describeWorkerStatus(status.value, status.checkedAt) : null;
  return (
    <div className="worker-status">
      <div className="worker-status" aria-live="polite">
        {status === undefined ? (
          <p className="parent-section__hint">
            <Spinner size="sm" decorative /> {t.worker.checking}
          </p>
        ) : view ? (
          <>
            <p className="sync-state sync-state--compact">
              <span className={`sync-state__dot sync-state__dot--${view.tone}`} aria-hidden="true" />
              {view.text}
            </p>
            {view.queued.map((line) => (
              <p key={line} className="parent-section__hint">
                {line}
              </p>
            ))}
            {view.subscription && (
              <div className="worker-usage">
                <p className="sync-state sync-state--compact">
                  <span className={`sync-state__dot sync-state__dot--${view.subscription.tone}`} aria-hidden="true" />
                  {view.subscription.text}
                </p>
                {view.subscription.details.map((line) => (
                  <p key={line} className="parent-section__hint">
                    {line}
                  </p>
                ))}
                {view.estimate.map((line) => (
                  <p key={line} className="worker-usage__estimate">
                    {line}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="parent-section__hint">{t.worker.unavailable}</p>
        )}
      </div>
      <div className="parent-actions">
        <Button size="parent" variant="secondary" icon="🔄" loading={loading} onClick={() => void refresh()}>
          {t.worker.refresh}
        </Button>
      </div>
    </div>
  );
}

/**
 * Settings of the family: on screen the help on / off, the reading of the photos by the home computer and the safety; the
 * features one by one, limits, reader and privacy in « Réglages avancés » (§27).
 */
export default function AISettingsPage(): JSX.Element {
  const toast = useToast();
  const cached = useSessionStore((s) => s.parentSettings);
  const [draft, setDraftState] = useState<ParentSettings | null>(() => (cached ? completeSettings(cached) : null));
  const [base, setBase] = useState<ParentSettings | null>(() => (cached ? completeSettings(cached) : null));
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const edited = useRef(false);

  const setDraft = (update: (d: ParentSettings | null) => ParentSettings | null): void => {
    edited.current = true;
    setDraftState(update);
  };

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then(async (fresh) => {
        await useSessionStore.getState().setParentSettings(fresh);
        if (cancelled || edited.current) return;
        const complete = completeSettings(fresh);
        setDraftState(complete);
        setBase(complete);
      })
      .catch(async (error: unknown) => {
        await reportSessionError(error);
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (draft === null) {
    return (
      <ParentPage title={t.title} intro={t.intro}>
        {loadFailed ? <EmptyState emoji="⚠️" title={t.loadFailed} /> : <Spinner size="lg" />}
      </ParentPage>
    );
  }

  const dirty = base === null || !sameSettings(draft, base);
  const setAi = <K extends keyof AiSettings>(key: K, value: AiSettings[K]): void =>
    setDraft((d) => (d ? { ...d, ai: { ...d.ai, [key]: value } } : d));
  const setFeature = (key: keyof Features, value: boolean): void =>
    setDraft((d) => (d ? { ...d, ai: { ...d.ai, features: { ...d.ai.features, [key]: value } } } : d));
  const setPrivacy = <K extends keyof ParentSettings['privacy']>(key: K, value: boolean): void =>
    setDraft((d) => (d ? { ...d, privacy: { ...d.privacy, [key]: value } } : d));
  const aiOff = !draft.ai.enabled;

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const saved = await putSettings({ ...draft, updatedAt: Date.now() });
      await useSessionStore.getState().setParentSettings(saved);
      const complete = completeSettings(saved);
      edited.current = false;
      setDraftState(complete);
      setBase(complete);
      toast.success(t.saved);
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ParentPage title={t.title} intro={t.intro}>
      <ParentSection title={t.sections.ai}>
        <Toggle size="parent" label={t.enabled} description={t.enabledHint} checked={draft.ai.enabled} onChange={(v) => setAi('enabled', v)} />
      </ParentSection>

      <ParentSection title={t.sections.ocr}>
        <Toggle
          size="parent"
          label={t.aiTranscription}
          description={t.aiTranscriptionHint}
          checked={draft.ocr.aiTranscription}
          onChange={(v) => setDraft((d) => (d ? { ...d, ocr: { ...d.ocr, aiTranscription: v } } : d))}
        />
        {draft.ocr.aiTranscription && (!draft.privacy.uploadPageImages || !draft.privacy.syncDocumentText) && (
          <p className="form-notice" role="note">
            {format(t.aiTranscriptionNeeds, { images: t.uploadPageImages, text: t.syncDocumentText })}
          </p>
        )}
        <WorkerStatusPanel />
        <p className="parent-section__hint">
          <Link to="/parent/diagnostic">{documents.diagnostic.link}</Link> — {documents.diagnostic.linkHint}
        </p>
      </ParentSection>

      <ParentSection title={t.sections.safety} hint={t.safetyHint}>
        <Segmented
          size="parent"
          label={t.safetyLevel}
          options={safetyOptions}
          value={draft.safety.level}
          onChange={(level) => setDraft((d) => (d ? { ...d, safety: { level } } : d))}
        />
      </ParentSection>

      <AdvancedSettings label={t.advanced} hint={t.advancedHint} open={advanced} onToggle={() => setAdvanced((open) => !open)}>
        <ParentSection title={t.sections.features}>
          {FEATURE_ROWS.map((row) => (
            <Toggle
              key={row.key}
              size="parent"
              label={row.label}
              description={row.hint}
              checked={draft.ai.features[row.key]}
              disabled={aiOff}
              onChange={(v) => setFeature(row.key, v)}
            />
          ))}
          <Toggle size="parent" label={t.handwriting} description={t.handwritingHint} checked={draft.ai.handwritingRecognition} disabled={aiOff} onChange={(v) => setAi('handwritingRecognition', v)} />
          <Toggle
            size="parent"
            label={t.features.freeQuestion}
            description={t.features.freeQuestionHint}
            checked={draft.ai.features.freeQuestion}
            disabled={aiOff}
            onChange={(v) => setFeature('freeQuestion', v)}
          />
          <div className="protections-note" role="note" aria-label={t.features.freeQuestionProtectionsTitle}>
            <p className="protections-note__title">
              <span aria-hidden="true">🛡️ </span>
              {t.features.freeQuestionProtectionsTitle}
            </p>
            <ul className="protections-note__list">
              {t.features.freeQuestionProtections.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </ParentSection>

        <ParentSection title={t.sections.limits}>
          <Slider
            size="parent"
            label={t.dailyLimit}
            min={0}
            max={200}
            step={5}
            value={draft.ai.dailyRequestLimitPerChild}
            disabled={aiOff}
            formatValue={(v) => format(t.requestsValue, { value: v })}
            onChange={(v) => setAi('dailyRequestLimitPerChild', v)}
          />
          <Slider
            size="parent"
            label={t.monthlyBudget}
            min={0}
            max={100}
            step={1}
            value={draft.ai.monthlyBudgetEur}
            disabled={aiOff}
            formatValue={(v) => format(t.euroValue, { value: v })}
            onChange={(v) => setAi('monthlyBudgetEur', v)}
          />
          <p className="parent-section__hint">{t.monthlyBudgetHint}</p>
          <Toggle size="parent" label={t.allowComplex} description={t.allowComplexHint} checked={draft.ai.allowComplexModel} disabled={aiOff} onChange={(v) => setAi('allowComplexModel', v)} />
          <Toggle size="parent" label={t.deepQuestions} description={t.deepQuestionsHint} checked={draft.ai.deepQuestions} disabled={aiOff || !draft.ai.allowComplexModel} onChange={(v) => setAi('deepQuestions', v)} />
        </ParentSection>

        <ParentSection title={t.sections.reader}>
          <Toggle
            size="parent"
            label={t.freeSelection}
            description={t.freeSelectionHint}
            checked={draft.reader.freeSelection}
            onChange={(v) => setDraft((d) => (d ? { ...d, reader: { freeSelection: v } } : d))}
          />
        </ParentSection>

        <ParentSection title={t.sections.privacy}>
          <Toggle size="parent" label={t.syncAnnotations} description={t.syncAnnotationsHint} checked={draft.privacy.syncAnnotations} onChange={(v) => setPrivacy('syncAnnotations', v)} />
          <Toggle size="parent" label={t.syncDocumentText} description={t.syncDocumentTextHint} checked={draft.privacy.syncDocumentText} onChange={(v) => setPrivacy('syncDocumentText', v)} />
          <Toggle size="parent" label={t.uploadPageImages} description={t.uploadPageImagesHint} checked={draft.privacy.uploadPageImages} onChange={(v) => setPrivacy('uploadPageImages', v)} />
          <Toggle size="parent" label={t.uploadOriginals} description={t.uploadOriginalsHint} checked={draft.privacy.uploadOriginals} onChange={(v) => setPrivacy('uploadOriginals', v)} />
        </ParentSection>
      </AdvancedSettings>

      <div className="parent-sticky-actions">
        {dirty && <p className="parent-sticky-actions__status">{t.unsaved}</p>}
        <Button size="parent" loading={saving} disabled={!dirty} onClick={() => void save()}>
          {t.save}
        </Button>
      </div>
    </ParentPage>
  );
}
