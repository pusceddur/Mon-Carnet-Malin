import { DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES, LIMITS, type ChildProfile } from '@aide/shared';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { requestAI } from '../../ai/aiClient';
import { Button, EmptyState, OfflineBadge, PageHeader, Spinner, TextArea } from '../../design/components';
import { readingFontClass, readingStyleVars } from '../../design/reading';
import { format } from '../../i18n/fr';
import { question as t } from '../../i18n/fr/question';
import { useOnlineStatus } from '../../platform/online';
import { PATHS } from '../../state/guards';
import { useSelectedChild, useSessionStore } from '../../state/session';
import { useDocumentTitle } from '../../state/useDocumentTitle';
import { SpeechEngine, speechEngine } from '../../tts/SpeechEngine';
import { getStoredVoiceURI } from '../../tts/voices';
import {
  answerParagraphs,
  buildFreeQuestionRequest,
  cleanQuestion,
  freeQuestionEnabled,
  isAskable,
  spokenAnswer,
  toQuestionOutcome,
  type QuestionAsk,
  type QuestionOutcome,
} from './model';
import './question.css';

type Phase =
  | { name: 'form' }
  | { name: 'asking'; ask: QuestionAsk }
  | { name: 'done'; ask: QuestionAsk; outcome: QuestionOutcome };

const MESSAGE_EMOJI: Record<Exclude<QuestionOutcome['kind'], 'answer'>, string> = {
  blocked: '🙂',
  adult_redirect: '💛',
  unavailable: '🌙',
};

function ListenButton({ text, label, ariaLabel }: { text: string; label: string; ariaLabel: string }): JSX.Element | null {
  if (!SpeechEngine.isSupported() || text.trim() === '') return null;
  return (
    <Button variant="secondary" icon="🔊" aria-label={ariaLabel} onClick={() => speechEngine.speakOnce(text)}>
      {label}
    </Button>
  );
}

/** The child's voice (chosen on this iPad) and speed for « 🔊 Écouter ». */
function useChildVoice(child: ChildProfile): void {
  const tts = { ...DEFAULT_TTS_PREFERENCES, ...child.tts };
  useEffect(() => {
    let cancelled = false;
    void getStoredVoiceURI().then((uri) => {
      if (!cancelled) speechEngine.setVoice(uri);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    speechEngine.setRate(tts.rate);
    speechEngine.setPitch(tts.pitch);
  }, [tts.rate, tts.pitch]);
  useEffect(() => () => speechEngine.stop(), []);
}

/** « Pose ta question » (§18.4): one free question at a time, answer in the child's reading style. */
export default function QuestionPage(): JSX.Element {
  useDocumentTitle(t.documentTitle);
  const navigate = useNavigate();
  const child = useSelectedChild();
  const enabled = useSessionStore((s) => freeQuestionEnabled(s.parentSettings));
  const goHome = (): void => {
    void navigate(PATHS.home);
  };

  if (!child) return <Navigate to={PATHS.root} replace />;
  return (
    <main className="page question-page">
      <PageHeader title={t.title} onBack={goHome} backLabel={t.back} actions={<OfflineBadge />} />
      <div className="page__body page__body--narrow">
        {enabled ? (
          <QuestionScreen child={child} />
        ) : (
          <EmptyState
            emoji="🙋"
            title={t.disabled.title}
            message={t.disabled.message}
            action={<Button onClick={goHome}>{t.disabled.home}</Button>}
          />
        )}
      </div>
    </main>
  );
}

function QuestionScreen({ child }: { child: ChildProfile }): JSX.Element {
  useChildVoice(child);
  const online = useOnlineStatus();
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>({ name: 'form' });
  const controller = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLElement | null>(null);
  const setResultElement = useCallback((element: HTMLElement | null): void => {
    resultRef.current = element;
  }, []);
  const focusNext = useRef<'input' | 'result' | null>(null);
  const inputId = useId();
  const hintId = useId();
  const counterId = useId();
  const answerTitleId = useId();

  const reading = { ...DEFAULT_READING_PREFERENCES, ...child.reading };
  const length = cleanQuestion(text).length;
  const tooLong = length > LIMITS.freeQuestionMaxChars;
  const canAsk = online && isAskable(text) && phase.name !== 'asking';

  useEffect(() => () => controller.current?.abort(), []);

  // Focus after the screen changed: the answer (or message) once it arrives, the text field for a new question.
  useEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    if (target === 'result' && phase.name === 'done') {
      focusNext.current = null;
      resultRef.current?.focus();
    } else if (target === 'input' && phase.name === 'form') {
      focusNext.current = null;
      inputRef.current?.focus();
    }
  }, [phase]);

  const ask = useCallback(async (next: QuestionAsk): Promise<void> => {
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    speechEngine.stop();
    setPhase({ name: 'asking', ask: next });
    const result = await requestAI('free_question', buildFreeQuestionRequest(child.id, next), { signal: ctl.signal });
    if (ctl.signal.aborted) return;
    controller.current = null;
    focusNext.current = 'result';
    setPhase({ name: 'done', ask: next, outcome: toQuestionOutcome(result) });
  }, [child.id]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!canAsk) return;
    void ask({ question: cleanQuestion(text), previous: null, mode: 'normal' });
  };

  const stop = (): void => {
    controller.current?.abort();
    controller.current = null;
    focusNext.current = 'input';
    setPhase({ name: 'form' });
  };

  const newQuestion = (): void => {
    speechEngine.stop();
    setText('');
    focusNext.current = 'input';
    setPhase({ name: 'form' });
  };

  const renderForm = (): JSX.Element => (
    <form className="question-card question-form" onSubmit={submit} noValidate>
      <label htmlFor={inputId} className="question-form__label">
        {t.form.label}
      </label>
      <p id={hintId} className="question-form__hint">
        {t.form.hint}
      </p>
      <TextArea
        ref={inputRef}
        id={inputId}
        className="question-form__input"
        value={text}
        rows={4}
        lang="fr"
        autoCapitalize="sentences"
        autoComplete="off"
        spellCheck
        placeholder={t.form.placeholder}
        aria-describedby={`${hintId} ${counterId}`}
        aria-invalid={tooLong || undefined}
        onChange={(event) => setText(event.target.value)}
      />
      <p id={counterId} className={`question-form__counter${tooLong ? ' question-form__counter--over' : ''}`}>
        <span aria-hidden="true">{format(t.form.counter, { count: length, max: LIMITS.freeQuestionMaxChars })}</span>
        <span className="visually-hidden">{format(t.form.counterLabel, { count: length, max: LIMITS.freeQuestionMaxChars })}</span>
      </p>
      <div aria-live="polite">
        {tooLong && <p className="question-notice question-notice--warn">{t.form.tooLong}</p>}
        {!online && <p className="question-notice">{t.form.offline}</p>}
      </div>
      <Button type="submit" block disabled={!canAsk}>
        {t.form.submit}
      </Button>
    </form>
  );

  const renderWaiting = (current: QuestionAsk): JSX.Element => (
    <section className="question-card question-waiting" aria-busy="true">
      <p className="question-asked">
        <span className="question-asked__label">{t.answer.yourQuestion}</span> « {current.question} »
      </p>
      <div className="question-waiting__status">
        <Spinner size="lg" decorative />
        <p className="question-waiting__text">{current.mode === 'simpler' ? t.waiting.simpler : t.waiting.normal}</p>
      </div>
      <div className="question-actions">
        <Button variant="ghost" onClick={stop}>
          {t.waiting.stop}
        </Button>
      </div>
    </section>
  );

  const renderAnswer = (current: QuestionAsk, outcome: Extract<QuestionOutcome, { kind: 'answer' }>): JSX.Element => {
    const previous = { question: current.question, answer: outcome.answer };
    return (
      <section className="question-card question-answer" aria-labelledby={answerTitleId}>
        <h2 id={answerTitleId} ref={setResultElement} tabIndex={-1} className="question-answer__title">
          {t.answer.title}
        </h2>
        <p className="question-asked">
          <span className="question-asked__label">{t.answer.yourQuestion}</span> « {current.question} »
        </p>
        <div className={`question-answer__text reading ${readingFontClass(reading.font)}`} style={readingStyleVars(reading)}>
          {answerParagraphs(outcome.answer).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
          {outcome.example && (
            <p className="question-answer__example">
              <strong>{t.answer.example}</strong> {outcome.example}
            </p>
          )}
        </div>
        <div className="question-actions">
          <ListenButton text={spokenAnswer(outcome)} label={t.answer.listen} ariaLabel={t.answer.listenLabel} />
          <Button variant="secondary" icon="🤔" disabled={!online} onClick={() => void ask({ question: current.question, previous, mode: 'simpler' })}>
            {t.answer.notUnderstood}
          </Button>
        </div>
        {outcome.suggestions.length > 0 && (
          <div className="question-suggestions">
            <h3 className="question-suggestions__title">{t.answer.suggestionsTitle}</h3>
            <ul className="question-suggestions__list">
              {outcome.suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    className="question-chip"
                    disabled={!online}
                    onClick={() => {
                      setText(suggestion);
                      void ask({ question: suggestion, previous, mode: 'normal' });
                    }}
                  >
                    <span className="question-chip__emoji" aria-hidden="true">
                      💬
                    </span>
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="question-actions">
          <Button icon="✏️" onClick={newQuestion}>
            {t.answer.newQuestion}
          </Button>
        </div>
      </section>
    );
  };

  const renderMessage = (current: QuestionAsk, outcome: Exclude<QuestionOutcome, { kind: 'answer' }>): JSX.Element => {
    const message = outcome.kind === 'unavailable' && outcome.offline ? t.message.offline : outcome.message;
    const canRetry = outcome.kind === 'unavailable' && outcome.canRetry;
    return (
      <section className={`question-card question-message question-message--${outcome.kind}`}>
        <span className="question-message__emoji" aria-hidden="true">
          {MESSAGE_EMOJI[outcome.kind]}
        </span>
        <p ref={setResultElement} tabIndex={-1} className="question-message__text">
          {message}
        </p>
        <div className="question-actions">
          <ListenButton text={message} label={t.message.listen} ariaLabel={t.message.listenLabel} />
          {canRetry && (
            <Button variant="secondary" icon="🔄" disabled={!online} onClick={() => void ask(current)}>
              {t.message.retry}
            </Button>
          )}
          <Button icon="✏️" onClick={newQuestion}>
            {t.message.newQuestion}
          </Button>
        </div>
      </section>
    );
  };

  return (
    <div className="question-screen">
      {phase.name === 'form' && renderForm()}
      {/* Always mounted, so the waiting text and the answer are announced when they appear. */}
      <div className="question-result" aria-live="polite">
        {phase.name === 'asking' && renderWaiting(phase.ask)}
        {phase.name === 'done' && (phase.outcome.kind === 'answer' ? renderAnswer(phase.ask, phase.outcome) : renderMessage(phase.ask, phase.outcome))}
      </div>
    </div>
  );
}
