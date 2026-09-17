import type { JSX } from 'react';
import { IconButton, MinusIcon, PlusIcon, Segmented } from '../../../design/components';
import { exercises as t } from '../../../i18n/fr/exercises';
import { fullRange, stepRange, type PageSelection, type PageSelectionMode } from '../lib/documentPages';
import { plural } from '../lib/texts';
import { Notice } from './common';

export interface PageRangePickerProps {
  pageCount: number;
  selection: PageSelection;
  onChange: (selection: PageSelection) => void;
  readableCount: number;
  notReadyCount: number;
  disabled?: boolean;
}

function Stepper({ label, value, onDecrease, onIncrease, decreaseLabel, increaseLabel, canDecrease, canIncrease, disabled }: {
  label: string;
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseLabel: string;
  increaseLabel: string;
  canDecrease: boolean;
  canIncrease: boolean;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="ex-stepper" role="group" aria-label={`${label} ${value}`}>
      <span className="ex-stepper__label">{label}</span>
      <IconButton aria-label={decreaseLabel} icon={<MinusIcon size={26} />} variant="secondary" onClick={onDecrease} disabled={disabled || !canDecrease} />
      <output className="ex-stepper__value" aria-live="polite">
        {value}
      </output>
      <IconButton aria-label={increaseLabel} icon={<PlusIcon size={26} />} variant="secondary" onClick={onIncrease} disabled={disabled || !canIncrease} />
    </div>
  );
}

/** « Tout le livre » or a simple page interval chosen with big − / + buttons (page numbers shown 1-based). */
export function PageRangePicker({ pageCount, selection, onChange, readableCount, notReadyCount, disabled = false }: PageRangePickerProps): JSX.Element {
  const { range } = selection;
  const last = Math.max(0, pageCount - 1);
  const setMode = (mode: PageSelectionMode): void => {
    onChange({ mode, range: mode === 'all' ? fullRange(pageCount) : range });
  };
  const step = (end: 'from' | 'to', delta: number): void => {
    onChange({ mode: 'range', range: stepRange(range, end, delta, pageCount) });
  };

  return (
    <section className="ex-card ex-stack">
      <Segmented<PageSelectionMode>
        label={t.pages.groupLabel}
        value={selection.mode}
        onChange={setMode}
        disabled={disabled || pageCount <= 1}
        options={[
          { value: 'all', label: t.pages.all },
          { value: 'range', label: t.pages.range },
        ]}
      />
      {selection.mode === 'range' && pageCount > 1 && (
        <div className="ex-range">
          <Stepper
            label={t.pages.from}
            value={range.from + 1}
            onDecrease={() => step('from', -1)}
            onIncrease={() => step('from', 1)}
            decreaseLabel={t.pages.decreaseFrom}
            increaseLabel={t.pages.increaseFrom}
            canDecrease={range.from > 0}
            canIncrease={range.from < last}
            disabled={disabled}
          />
          <Stepper
            label={t.pages.to}
            value={range.to + 1}
            onDecrease={() => step('to', -1)}
            onIncrease={() => step('to', 1)}
            decreaseLabel={t.pages.decreaseTo}
            increaseLabel={t.pages.increaseTo}
            canDecrease={range.to > 0}
            canIncrease={range.to < last}
            disabled={disabled}
          />
        </div>
      )}
      {readableCount === 0 ? (
        <Notice tone="warn">{t.pages.noneReady}</Notice>
      ) : notReadyCount > 0 ? (
        <Notice>{plural(notReadyCount, t.pages.someNotReadyOne, t.pages.someNotReadyMany)}</Notice>
      ) : null}
    </section>
  );
}
