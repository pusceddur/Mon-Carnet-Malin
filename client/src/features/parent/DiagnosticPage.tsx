import { useRef, useState, type JSX } from 'react';
import { runSelfTest, SELF_TEST_STEPS, type SelfTestStatus, type SelfTestStep } from '../../documents/selfTest';
import { Button, Spinner } from '../../design/components';
import { format } from '../../i18n/fr';
import { documents } from '../../i18n/fr/documents';
import { ParentPage, ParentSection } from './ParentPage';

const t = documents.diagnostic;

const ICONS: Record<SelfTestStatus, string> = { pending: '⏳', running: '', ok: '✅', warning: '⚠️', error: '❌', skipped: '➖' };

const initialSteps = (): SelfTestStep[] => SELF_TEST_STEPS.map((id) => ({ id, status: 'pending', durationMs: null, detail: null }));

/** Parent area: device self-test of the document pipeline (photos, PDF, on-device and server reading). */
export default function DiagnosticPage(): JSX.Element {
  const [steps, setSteps] = useState<SelfTestStep[]>(initialSteps);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const runningRef = useRef(false);

  const start = async (): Promise<void> => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setDone(false);
    setSteps(initialSteps());
    try {
      await runSelfTest(setSteps);
    } finally {
      runningRef.current = false;
      setRunning(false);
      setDone(true);
    }
  };

  const problems = steps.some((s) => s.status === 'error' || s.status === 'warning');

  return (
    <ParentPage title={t.title} intro={t.intro}>
      <ParentSection title={t.title}>
        <ol className="diagnostic-steps" aria-live="polite">
          {steps.map((step) => (
            <li key={step.id} className={`diagnostic-step diagnostic-step--${step.status}`}>
              <span className="diagnostic-step__icon" aria-hidden="true">
                {step.status === 'running' ? <Spinner size="sm" decorative /> : ICONS[step.status]}
              </span>
              <span className="diagnostic-step__body">
                <span className="diagnostic-step__title">
                  {t.steps[step.id]} · <strong>{t.status[step.status]}</strong>
                  {step.durationMs !== null && ` · ${format(t.duration, { seconds: (step.durationMs / 1000).toFixed(1) })}`}
                </span>
                {step.detail && <span className="diagnostic-step__detail">{step.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
        {done && (
          <p className="parent-section__hint" role="status">
            {problems ? t.someProblems : t.allGood} {t.sent}
          </p>
        )}
        <Button size="parent" loading={running} onClick={() => void start()}>
          {running ? t.running : done ? t.rerun : t.run}
        </Button>
      </ParentSection>
    </ParentPage>
  );
}
