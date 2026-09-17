import { KID_MESSAGES, LIMITS, type SourceRef } from '@aide/shared';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { BottomSheet, Button, Spinner, TextArea } from '../../design/components';
import { format } from '../../i18n/fr';
import { help } from '../../i18n/fr/help';
import { speechEngine } from '../../tts/SpeechEngine';
import {
  runDefinition,
  runExplain,
  runQuestion,
  runSimplify,
  type HelpKind,
  type HelpOutcome,
  type HelpTextContext,
  type QuestionContext,
} from './helpActions';

export type HelpRequest =
  | { id: number; kind: 'definition' | 'explain' | 'simplify'; ctx: HelpTextContext }
  | { id: number; kind: 'question' };

export interface HelpSheetProps {
  request: HelpRequest | null;
  onClose(): void;
  /** 📖 not found / hard definition → 💡 on the same selection. */
  onExplainInstead(ctx: HelpTextContext): void;
  onShowQuote(ref: SourceRef): void;
  loadQuestionContext(): Promise<QuestionContext | null>;
  /** Statistics (ReadingSession). */
  onOutcome?(kind: HelpKind, outcome: HelpOutcome): void;
}

type Phase =
  | { name: 'loading' }
  | { name: 'form' }
  | { name: 'done'; outcome: HelpOutcome };

const PREVIEW_MAX = 160;

function preview(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > PREVIEW_MAX ? `${clean.slice(0, PREVIEW_MAX - 1)}…` : clean;
}

function ListenButton({ text }: { text: string }): JSX.Element {
  return (
    <Button variant="secondary" aria-label={help.listenLabel} onClick={() => speechEngine.speakOnce(text)}>
      {help.listen}
    </Button>
  );
}

function SourceWarning({ show }: { show: boolean }): JSX.Element | null {
  return show ? <p className="rd-help__warning" role="note">{KID_MESSAGES.sourceWarning}</p> : null;
}

/** Bottom sheet with the answer to 📖 / 💡 / ✨ / ❓. Loading, result with 🔊, not in text, blocked, unavailable. */
export function HelpSheet({ request, onClose, onExplainInstead, onShowQuote, loadQuestionContext, onOutcome }: HelpSheetProps): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [question, setQuestion] = useState('');
  const [skipLocal, setSkipLocal] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const questionId = useId();
  const counterId = useId();
  const onOutcomeRef = useRef(onOutcome);
  onOutcomeRef.current = onOutcome;

  const cancelRunning = (): void => {
    controller.current?.abort();
    controller.current = null;
  };

  // New request: reset.
  const requestId = request?.id ?? null;
  const [seenRequest, setSeenRequest] = useState<number | null>(null);
  if (requestId !== seenRequest) {
    setSeenRequest(requestId);
    setSkipLocal(false);
    setAttempt(0);
    setQuestion('');
    setPhase(request?.kind === 'question' ? { name: 'form' } : { name: 'loading' });
  }

  useEffect(() => {
    if (!request || request.kind === 'question') return undefined;
    cancelRunning();
    const ctl = new AbortController();
    controller.current = ctl;
    setPhase({ name: 'loading' });
    const run = async (): Promise<HelpOutcome> => {
      switch (request.kind) {
        case 'definition':
          return runDefinition(request.ctx.text);
        case 'explain':
          return runExplain(request.ctx, { skipLocal, signal: ctl.signal });
        case 'simplify':
          return runSimplify(request.ctx, { signal: ctl.signal });
      }
    };
    void run().then((outcome) => {
      if (ctl.signal.aborted) return;
      setPhase({ name: 'done', outcome });
      onOutcomeRef.current?.(request.kind, outcome);
    });
    return () => ctl.abort();
  }, [request, skipLocal, attempt]);

  useEffect(() => () => cancelRunning(), []);

  const submitQuestion = useCallback((event?: FormEvent) => {
    event?.preventDefault();
    if (!request || request.kind !== 'question') return;
    cancelRunning();
    const ctl = new AbortController();
    controller.current = ctl;
    const asked = question;
    setPhase({ name: 'loading' });
    void (async () => {
      const ctx = await loadQuestionContext();
      const outcome = ctx
        ? await runQuestion(ctx, asked, { signal: ctl.signal })
        : { kind: 'message' as const, text: help.question.noText, tone: 'info' as const, canRetry: false };
      if (ctl.signal.aborted) return;
      if (outcome.kind === 'message' && outcome.text === help.question.empty) {
        setPhase({ name: 'form' });
        return;
      }
      setPhase({ name: 'done', outcome });
      onOutcomeRef.current?.('question', outcome);
    })();
  }, [request, question, loadQuestionContext]);

  const close = (): void => {
    cancelRunning();
    onClose();
  };

  const kind: HelpKind = request?.kind ?? 'explain';
  const selectedText = request && request.kind !== 'question' ? request.ctx.text : null;
  const retry = (): void => {
    if (kind === 'question') submitQuestion();
    else setAttempt((a) => a + 1);
  };

  const renderOutcome = (outcome: HelpOutcome): JSX.Element => {
    switch (outcome.kind) {
      case 'definition':
        return (
          <div className="rd-help__result">
            <p className="rd-help__headword">
              <strong>{outcome.headword}</strong>
              {outcome.partOfSpeech && help.partOfSpeech[outcome.partOfSpeech as keyof typeof help.partOfSpeech]
                ? <span className="rd-help__pos"> · {help.partOfSpeech[outcome.partOfSpeech as keyof typeof help.partOfSpeech]}</span>
                : null}
            </p>
            <p className="rd-help__text">{outcome.definition}</p>
            {outcome.example && (
              <p className="rd-help__example"><span className="rd-help__label">{help.example} : </span>{outcome.example}</p>
            )}
            {outcome.attribution && <p className="rd-help__attribution">{format(help.attribution, { source: outcome.attribution })}</p>}
            <div className="rd-help__actions">
              <ListenButton text={[outcome.definition, outcome.example].filter(Boolean).join(' ')} />
              {!outcome.kidFriendly && request && request.kind !== 'question' && (
                <Button variant="primary" onClick={() => onExplainInstead(request.ctx)}>{help.askExplain}</Button>
              )}
            </div>
            {!outcome.kidFriendly && <p className="rd-help__hint">{help.definitionHard}</p>}
          </div>
        );
      case 'definition_not_found':
        return (
          <div className="rd-help__result">
            <p className="rd-help__text">{help.notFound}</p>
            {request && request.kind !== 'question' && (
              <div className="rd-help__actions">
                <Button variant="primary" onClick={() => onExplainInstead(request.ctx)}>{help.askExplain}</Button>
              </div>
            )}
          </div>
        );
      case 'explanation':
        return (
          <div className="rd-help__result">
            <p className="rd-help__text">{outcome.text}</p>
            {outcome.example && (
              <p className="rd-help__example"><span className="rd-help__label">{help.example} : </span>{outcome.example}</p>
            )}
            <SourceWarning show={outcome.sourceWarning} />
            <div className="rd-help__actions">
              <ListenButton text={[outcome.text, outcome.example].filter(Boolean).join(' ')} />
              {outcome.fromGlossary && <Button variant="secondary" onClick={() => setSkipLocal(true)}>{help.moreHelp}</Button>}
            </div>
          </div>
        );
      case 'simplified':
        return (
          <div className="rd-help__result">
            <p className="rd-help__text rd-help__text--reading">{outcome.text}</p>
            <SourceWarning show={outcome.sourceWarning} />
            <div className="rd-help__actions"><ListenButton text={outcome.text} /></div>
          </div>
        );
      case 'answer':
        return (
          <div className="rd-help__result">
            <p className="rd-help__text">{outcome.text}</p>
            <SourceWarning show={outcome.sourceWarning} />
            <div className="rd-help__actions">
              <ListenButton text={outcome.text} />
              {outcome.refs.slice(0, 3).map((ref, i) => (
                <Button key={`${ref.pageIndex}-${i}`} variant="secondary" onClick={() => onShowQuote(ref)}>
                  {format(help.seeInText, { page: ref.pageIndex + 1 })}
                </Button>
              ))}
              <Button variant="ghost" onClick={() => setPhase({ name: 'form' })}>{help.question.another}</Button>
            </div>
          </div>
        );
      case 'message':
        return (
          <div className="rd-help__result">
            <p className={`rd-help__message rd-help__message--${outcome.tone}`} role="status">{outcome.text}</p>
            <div className="rd-help__actions">
              <ListenButton text={outcome.text} />
              {outcome.canRetry && <Button variant="secondary" onClick={retry}>{help.retry}</Button>}
              {kind === 'question' && !outcome.canRetry && (
                <Button variant="ghost" onClick={() => setPhase({ name: 'form' })}>{help.question.another}</Button>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <BottomSheet open={request !== null} onClose={close} title={help.titles[kind]}>
      <div className="rd-help" aria-live="polite">
        {selectedText && (
          <blockquote className="rd-help__selection">
            <span className="visually-hidden">{help.selectedText} </span>« {preview(selectedText)} »
          </blockquote>
        )}
        {phase.name === 'loading' && (
          <div className="rd-help__loading">
            <Spinner decorative />
            <p>{help.loading[kind]}</p>
          </div>
        )}
        {phase.name === 'form' && (
          <form className="rd-help__form" onSubmit={submitQuestion}>
            <p className="rd-help__intro">{help.question.intro}</p>
            <label htmlFor={questionId} className="rd-help__label">{help.question.label}</label>
            <TextArea
              id={questionId}
              value={question}
              maxLength={LIMITS.questionOnTextMaxChars}
              rows={3}
              placeholder={help.question.placeholder}
              aria-describedby={counterId}
              onChange={(event) => setQuestion(event.target.value.slice(0, LIMITS.questionOnTextMaxChars))}
            />
            <p id={counterId} className="rd-help__counter">
              {format(help.question.counter, { count: question.length, max: LIMITS.questionOnTextMaxChars })}
            </p>
            <Button type="submit" variant="primary" block disabled={question.trim() === ''}>{help.question.submit}</Button>
          </form>
        )}
        {phase.name === 'done' && renderOutcome(phase.outcome)}
      </div>
    </BottomSheet>
  );
}
