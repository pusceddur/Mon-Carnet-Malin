import type { Id, SourceRef } from '@aide/shared';
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button, IconButton, Spinner } from '../../../design/components';
import { format } from '../../../i18n/fr';
import { exercises as t } from '../../../i18n/fr/exercises';
import { SpeechEngine, speechEngine } from '../../../tts/SpeechEngine';
import { readerLink } from '../lib/links';

/** Stops any sentence read by this screen when it goes away. */
export function useStopSpeechOnUnmount(): void {
  useEffect(() => () => speechEngine.stop(), []);
}

/** « 🔊 » reads a text aloud (hidden when speech synthesis is missing). */
export function ListenButton({ text, label, compact = false }: { text: string; label: string; compact?: boolean }): JSX.Element | null {
  if (!SpeechEngine.isSupported() || text.trim().length === 0) return null;
  const speak = (): void => speechEngine.speakOnce(text);
  if (compact) return <IconButton aria-label={label} icon="🔊" variant="secondary" onClick={speak} />;
  return (
    <Button variant="secondary" icon="🔊" onClick={speak}>
      {label}
    </Button>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'calm'; children: ReactNode }): JSX.Element {
  return (
    <p className={`ex-notice ex-notice--${tone}`} role="status">
      {children}
    </p>
  );
}

/** « 📍 page N » chips opening the reader on the quoted passage. */
export function SourceLinks({ documentId, refs }: { documentId: Id; refs: readonly SourceRef[] }): JSX.Element | null {
  if (refs.length === 0) return null;
  return (
    <ul className="ex-sources">
      {refs.map((ref, index) => (
        <li key={`${ref.pageIndex}-${index}`}>
          <Link
            className="ex-source"
            to={readerLink(documentId, ref)}
            aria-label={format(t.summary.openSource, { page: ref.pageIndex + 1, quote: ref.quote })}
          >
            <span className="ex-source__page">
              <span aria-hidden="true">📍 </span>
              {format(t.common.pageShort, { page: ref.pageIndex + 1 })}
            </span>
            <span className="ex-source__quote">{format(t.common.quoted, { text: ref.quote })}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const STEP_MS = 6000;

/** Friendly wait for long requests: rotating short sentences, a spinner and a way out. */
export function WaitingPanel({ title, steps, onStop, stopLabel }: {
  title: string;
  steps?: readonly string[];
  onStop?: () => void;
  stopLabel?: string;
}): JSX.Element {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!steps || steps.length < 2) return undefined;
    const timer = window.setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), STEP_MS);
    return () => window.clearInterval(timer);
  }, [steps]);

  return (
    <section className="ex-card ex-waiting" aria-live="polite">
      <Spinner size="lg" decorative />
      <h2 className="ex-waiting__title">{title}</h2>
      {steps && steps.length > 0 && <p className="ex-waiting__step">{steps[step]}</p>}
      {onStop && stopLabel && (
        <Button variant="ghost" onClick={onStop}>
          {stopLabel}
        </Button>
      )}
    </section>
  );
}
