import type { AnswerResponse, Id, Question } from '@aide/shared';
import { useMemo, useState, type JSX } from 'react';
import { Button, IconButton } from '../../../design/components';
import { format } from '../../../i18n/fr';
import { exercises as t } from '../../../i18n/fr/exercises';
import {
  EMPTY_ASSOCIATION, isAssociationComplete, linkOfLeft, linkOfRight, selectLeft, selectRight, toResponsePairs, undoLast,
} from '../lib/association';
import type { InputMethod } from '../lib/correction';
import { moveItem, shuffledIndexes } from '../lib/ordering';

export interface SubmitMeta { inputMethod: InputMethod; inkAnnotationId: Id | null }
export type SubmitHandler = (response: AnswerResponse, meta: SubmitMeta) => void;

export interface InputProps<T extends Question['type']> {
  question: Extract<Question, { type: T }>;
  busy: boolean;
  onSubmit: SubmitHandler;
  /** Reading font class of the child profile. */
  fontClass: string;
}

const TOUCH: SubmitMeta = { inputMethod: 'toucher', inkAnnotationId: null };
export const PAIR_COLORS = 6;

export function SubmitBar({ disabled, busy, onClick }: { disabled: boolean; busy: boolean; onClick: () => void }): JSX.Element {
  return (
    <div className="ex-actions">
      <Button onClick={onClick} disabled={disabled && !busy} loading={busy} icon="✅">
        {busy ? t.player.checking : t.player.validate}
      </Button>
    </div>
  );
}

export function QcmInput({ question, busy, onSubmit, fontClass }: InputProps<'qcm'>): JSX.Element {
  const [choice, setChoice] = useState<number | null>(null);
  return (
    <>
      <div role="group" aria-label={t.player.qcm.groupLabel} className="ex-choices">
        {question.choices.map((text, index) => (
          <button
            key={index}
            type="button"
            className={`ex-choice ${fontClass}`}
            aria-pressed={choice === index}
            disabled={busy}
            onClick={() => setChoice(index)}
          >
            {text}
          </button>
        ))}
      </div>
      <SubmitBar
        disabled={choice === null}
        busy={busy}
        onClick={() => {
          if (choice !== null) onSubmit({ type: 'qcm', choiceIndex: choice }, TOUCH);
        }}
      />
    </>
  );
}

export function VraiFauxInput({ busy, onSubmit }: InputProps<'vrai_faux'>): JSX.Element {
  const [value, setValue] = useState<boolean | null>(null);
  const options = [
    { value: true, label: t.player.vraiFaux.vrai, emoji: t.player.vraiFaux.vraiEmoji },
    { value: false, label: t.player.vraiFaux.faux, emoji: t.player.vraiFaux.fauxEmoji },
  ];
  return (
    <>
      <div role="group" aria-label={t.player.vraiFaux.groupLabel} className="ex-truefalse">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            className="ex-choice ex-choice--big"
            aria-pressed={value === option.value}
            disabled={busy}
            onClick={() => setValue(option.value)}
          >
            <span aria-hidden="true" className="ex-choice__emoji">
              {option.emoji}
            </span>
            {option.label}
          </button>
        ))}
      </div>
      <SubmitBar
        disabled={value === null}
        busy={busy}
        onClick={() => {
          if (value !== null) onSubmit({ type: 'vrai_faux', value }, TOUCH);
        }}
      />
    </>
  );
}

export function AssociationInput({ question, busy, onSubmit, fontClass }: InputProps<'association'>): JSX.Element {
  const lefts = question.pairs.map((p) => p.left);
  const rightOrder = useMemo(() => shuffledIndexes(question.pairs.length, `${question.id}:association`), [question.id, question.pairs.length]);
  const rights = rightOrder.map((i) => question.pairs[i]?.right ?? '');
  const [state, setState] = useState(EMPTY_ASSOCIATION);

  const itemLabel = (text: string, number: number | null, selected: boolean): string => {
    if (selected) return format(t.player.association.selected, { item: text });
    return number === null ? text : format(t.player.association.pairedWith, { item: text, number });
  };

  return (
    <>
      <p className="ex-hint">{t.player.association.hint}</p>
      <div className="ex-assoc">
        <div role="group" aria-label={t.player.association.leftLabel} className="ex-assoc__col">
          {lefts.map((text, index) => {
            const link = linkOfLeft(state, index);
            const selected = state.selectedLeft === index;
            const number = link ? link.left + 1 : null;
            return (
              <button
                key={index}
                type="button"
                className={`ex-assoc__item ${fontClass}${link ? ` ex-pair-${link.left % PAIR_COLORS}` : ''}${selected ? ' ex-assoc__item--selected' : ''}`}
                aria-pressed={selected || link !== undefined}
                aria-label={itemLabel(text, number, selected)}
                disabled={busy}
                onClick={() => setState((s) => selectLeft(s, index))}
              >
                <span className="ex-assoc__text">{text}</span>
                {number !== null && (
                  <span className="ex-assoc__badge" aria-hidden="true">
                    {number}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div role="group" aria-label={t.player.association.rightLabel} className="ex-assoc__col">
          {rights.map((text, index) => {
            const link = linkOfRight(state, index);
            const number = link ? link.left + 1 : null;
            return (
              <button
                key={index}
                type="button"
                className={`ex-assoc__item ${fontClass}${link ? ` ex-pair-${link.left % PAIR_COLORS}` : ''}`}
                aria-pressed={link !== undefined}
                aria-label={itemLabel(text, number, false)}
                disabled={busy}
                onClick={() => setState((s) => selectRight(s, index))}
              >
                {number !== null && (
                  <span className="ex-assoc__badge" aria-hidden="true">
                    {number}
                  </span>
                )}
                <span className="ex-assoc__text">{text}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="ex-row">
        <Button
          variant="ghost"
          icon="↩️"
          disabled={busy || (state.links.length === 0 && state.selectedLeft === null)}
          onClick={() => setState(undoLast)}
        >
          {t.player.association.undo}
        </Button>
      </div>
      <SubmitBar
        disabled={!isAssociationComplete(state, lefts.length)}
        busy={busy}
        onClick={() => {
          if (isAssociationComplete(state, lefts.length)) onSubmit({ type: 'association', pairs: toResponsePairs(state, lefts, rights) }, TOUCH);
        }}
      />
    </>
  );
}

export function OrdreInput({ question, busy, onSubmit, fontClass }: InputProps<'ordre'>): JSX.Element {
  const [order, setOrder] = useState(() => shuffledIndexes(question.itemsInOrder.length, `${question.id}:ordre`));
  const items = order.map((i) => question.itemsInOrder[i] ?? '');

  return (
    <>
      <p className="ex-hint">{t.player.ordre.hint}</p>
      <ol className="ex-order">
        {items.map((text, position) => (
          <li key={order[position]} className="ex-order__item">
            <span className="ex-order__pos" aria-label={format(t.player.ordre.position, { position: position + 1 })}>
              {position + 1}
            </span>
            <span className={`ex-order__text ${fontClass}`}>{text}</span>
            <span className="ex-order__moves">
              <IconButton
                aria-label={format(t.player.ordre.moveUp, { item: text })}
                icon="⬆️"
                variant="secondary"
                disabled={busy || position === 0}
                onClick={() => setOrder((o) => moveItem(o, position, -1))}
              />
              <IconButton
                aria-label={format(t.player.ordre.moveDown, { item: text })}
                icon="⬇️"
                variant="secondary"
                disabled={busy || position === items.length - 1}
                onClick={() => setOrder((o) => moveItem(o, position, 1))}
              />
            </span>
          </li>
        ))}
      </ol>
      <SubmitBar disabled={false} busy={busy} onClick={() => onSubmit({ type: 'ordre', items }, TOUCH)} />
    </>
  );
}
