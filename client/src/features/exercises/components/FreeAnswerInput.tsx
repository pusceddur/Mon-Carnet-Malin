import { LIMITS, type Id } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useId, useState, type ChangeEvent, type JSX } from 'react';
import { Button, Field, TextArea } from '../../../design/components';
import { format } from '../../../i18n/fr';
import { exercises as t } from '../../../i18n/fr/exercises';
import { AnswerPad } from '../../../pencil';
import { useAbortable } from '../hooks';
import type { InputMethod } from '../lib/correction';
import { loadAnswerInk, recognizeAnswerInk } from '../lib/handwriting';
import { SubmitBar, type InputProps } from './ClosedInputs';
import { Notice } from './common';

type Tab = 'ecrire' | 'dessiner';

type Recognition =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'confirm'; text: string }
  | { kind: 'message'; text: string };

export interface FreeAnswerInputProps extends InputProps<'reponse_libre'> {
  childId: Id;
  exerciseId: Id;
  exerciseCreatedAt: number;
  documentId: Id | null;
  documentHash: string | null;
  /** ParentSettings.ai.handwritingRecognition (and help enabled). */
  handwritingRecognition: boolean;
}

/**
 * Two exclusive tabs: « Écrire » (plain textarea: Scribble, keyboard, dictation; no touch listeners around it) and
 * « Dessiner » (ink answer box saved as an annotation, optional « Transformer en texte » confirmed by the child).
 */
export function FreeAnswerInput(props: FreeAnswerInputProps): JSX.Element {
  const { question, busy, onSubmit, fontClass, childId, exerciseId, exerciseCreatedAt } = props;
  const baseId = useId();
  const [tab, setTab] = useState<Tab>('ecrire');
  const [text, setText] = useState('');
  const [method, setMethod] = useState<InputMethod>('clavier');
  const [lastInkId, setLastInkId] = useState<Id | null>(null);
  const [recognition, setRecognition] = useState<Recognition>({ kind: 'idle' });
  const { start, abort } = useAbortable();

  const inkIds = useLiveQuery(
    async () => (await loadAnswerInk(childId, exerciseId, question.id, exerciseCreatedAt)).map((a) => a.id),
    [childId, exerciseId, question.id, exerciseCreatedAt],
    [] as Id[],
  );
  const inkAnnotationId = inkIds.at(-1) ?? lastInkId;
  const hasInk = inkIds.length > 0 || lastInkId !== null;

  useEffect(() => {
    if (tab !== 'dessiner') abort();
  }, [tab, abort]);

  const onTextChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setText(event.target.value);
    const inputType = (event.nativeEvent as Partial<InputEvent>).inputType;
    if (inputType === 'insertFromDictation') setMethod('dictee');
  };

  const transform = async (): Promise<void> => {
    const signal = start();
    setRecognition({ kind: 'busy' });
    const outcome = await recognizeAnswerInk({
      childId,
      exerciseId,
      questionId: question.id,
      exerciseCreatedAt,
      documentId: props.documentId,
      documentHash: props.documentHash,
      signal,
    });
    if (signal.aborted) return;
    switch (outcome.kind) {
      case 'ok':
        setRecognition({ kind: 'confirm', text: outcome.text });
        break;
      case 'message':
        setRecognition({ kind: 'message', text: outcome.message });
        break;
      case 'image_error':
        setRecognition({ kind: 'message', text: t.player.libre.imageError });
        break;
      default:
        setRecognition({ kind: 'message', text: t.player.libre.recognizedEmpty });
    }
  };

  const acceptRecognized = (recognized: string): void => {
    setText(recognized);
    setMethod('ecriture');
    setRecognition({ kind: 'idle' });
    setTab('ecrire');
  };

  const tabs: { id: Tab; label: string; emoji: string }[] = [
    { id: 'ecrire', label: t.player.libre.writeTab, emoji: t.player.libre.writeEmoji },
    { id: 'dessiner', label: t.player.libre.drawTab, emoji: t.player.libre.drawEmoji },
  ];

  const trimmed = text.trim();
  return (
    <>
      <div role="tablist" aria-label={t.player.libre.tabsLabel} className="ex-tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            id={`${baseId}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`${baseId}-panel`}
            className="ex-tab"
            disabled={busy}
            onClick={() => setTab(item.id)}
          >
            <span aria-hidden="true">{item.emoji}</span> {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${tab}`} className="ex-tabpanel">
        {tab === 'ecrire' ? (
          <Field label={t.player.libre.answerLabel} hint={t.player.libre.answerHint}>
            <TextArea
              className={`ex-answer ${fontClass}`}
              value={text}
              onChange={onTextChange}
              maxLength={LIMITS.answerMaxChars}
              rows={5}
              lang="fr"
              autoCapitalize="sentences"
              disabled={busy}
            />
          </Field>
        ) : (
          <div className="ex-stack">
            <AnswerPad only="draw" exerciseId={exerciseId} questionId={question.id} childId={childId} onInkSaved={setLastInkId} />
            {hasInk && <p className="ex-muted">{t.player.libre.drawSavedInfo}</p>}
            {props.handwritingRecognition && hasInk && (
              <RecognitionBox
                recognition={recognition}
                disabled={busy}
                onTransform={() => void transform()}
                onAccept={acceptRecognized}
                onReject={() => setRecognition({ kind: 'idle' })}
              />
            )}
          </div>
        )}
      </div>

      <SubmitBar
        disabled={tab === 'ecrire' ? trimmed.length === 0 : !hasInk}
        busy={busy}
        onClick={() => {
          if (tab === 'ecrire' && trimmed.length > 0) {
            onSubmit({ type: 'reponse_libre', text: trimmed }, { inputMethod: method, inkAnnotationId: method === 'ecriture' ? inkAnnotationId : null });
          } else if (tab === 'dessiner' && hasInk) {
            onSubmit({ type: 'reponse_libre', text: '' }, { inputMethod: 'ecriture', inkAnnotationId });
          }
        }}
      />
    </>
  );
}

function RecognitionBox({ recognition, disabled, onTransform, onAccept, onReject }: {
  recognition: Recognition;
  disabled: boolean;
  onTransform: () => void;
  onAccept: (text: string) => void;
  onReject: () => void;
}): JSX.Element {
  if (recognition.kind === 'confirm') {
    return (
      <div className="ex-card ex-card--soft ex-stack" role="status">
        <p className="ex-muted">{t.player.libre.recognizedIntro}</p>
        <p className="ex-recognized">{format(t.common.quoted, { text: recognition.text })}</p>
        <p>{t.player.libre.recognizedQuestion}</p>
        <div className="ex-row">
          <Button icon="✅" onClick={() => onAccept(recognition.text)}>
            {t.player.libre.recognizedYes}
          </Button>
          <Button variant="secondary" icon="✖️" onClick={onReject}>
            {t.player.libre.recognizedNo}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="ex-stack">
      {recognition.kind === 'message' && <Notice tone="calm">{recognition.text}</Notice>}
      <div>
        <Button
          variant="secondary"
          icon={t.player.libre.transformEmoji}
          loading={recognition.kind === 'busy'}
          disabled={disabled}
          onClick={onTransform}
        >
          {recognition.kind === 'busy' ? t.player.libre.transforming : t.player.libre.transform}
        </Button>
      </div>
    </div>
  );
}
