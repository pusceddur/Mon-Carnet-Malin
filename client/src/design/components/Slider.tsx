import { useEffect, useId, useLayoutEffect, useRef, type CSSProperties, type JSX, type PointerEvent } from 'react';
import { format } from '../../i18n/fr';
import { common } from '../../i18n/fr/common';
import type { ControlSize } from './Button';
import { IconButton } from './IconButton';
import { cx } from './internal/cx';
import { MinusIcon, PlusIcon } from './internal/icons';
import { rangeFraction, snapToStep, valueFromPointer } from './internal/range';
import './Slider.css';

export interface SliderProps {
  value: number;
  /** Called with a value already clamped and snapped to `step`. */
  onChange: (value: number) => void;
  /** Called when an adjustment ends (finger lifted, stepper tapped, keyboard change): a good moment to save. */
  onChangeEnd?: (value: number) => void;
  min: number;
  max: number;
  /** Default 1. */
  step?: number;
  /** Visible label and accessible name. */
  label: string;
  hideLabel?: boolean;
  /** Displayed and announced value (default: the number, French formatting). */
  formatValue?: (value: number) => string;
  /** −/+ buttons for precise steps (dragging a thin control is hard for small hands). Default true. */
  showSteppers?: boolean;
  disabled?: boolean;
  /** Default `child`. */
  size?: ControlSize;
  id?: string;
  className?: string;
}

const TAP_SLOP_PX = 6;
const THUMB_PX: Readonly<Record<ControlSize, number>> = { child: 34, parent: 28 };

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** Touch-friendly range: tap anywhere on the track, drag horizontally (vertical pans still scroll the page), steppers. */
export function Slider({
  value,
  onChange,
  onChangeEnd,
  min,
  max,
  step = 1,
  label,
  hideLabel = false,
  formatValue,
  showSteppers = true,
  disabled = false,
  size = 'child',
  id,
  className,
}: SliderProps): JSX.Element {
  const autoId = useId();
  const inputId = id ?? autoId;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastValue = useRef(value);
  const onChangeEndRef = useRef(onChangeEnd);

  useLayoutEffect(() => {
    lastValue.current = value;
    onChangeEndRef.current = onChangeEnd;
  });

  // Native `change` fires once per committed keyboard or assistive-technology adjustment.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return undefined;
    const onNativeChange = (): void => onChangeEndRef.current?.(lastValue.current);
    input.addEventListener('change', onNativeChange);
    return () => input.removeEventListener('change', onNativeChange);
  }, []);

  const current = snapToStep(value, min, max, step);
  const display = formatValue ? formatValue(current) : numberFormat.format(current);

  const emit = (next: number): void => {
    const snapped = snapToStep(next, min, max, step);
    if (snapped !== lastValue.current) {
      lastValue.current = snapped;
      onChange(snapped);
    }
  };

  const stepBy = (direction: -1 | 1): void => {
    emit(current + direction * step);
    onChangeEnd?.(lastValue.current);
  };

  const setFromPointer = (clientX: number): void => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    emit(valueFromPointer(clientX, rect.left, rect.width, min, max, step, THUMB_PX[size]));
  };

  const capture = (event: PointerEvent<HTMLDivElement>): void => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released.
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const mouse = event.pointerType === 'mouse';
    gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: mouse };
    if (mouse) {
      event.preventDefault();
      capture(event);
      inputRef.current?.focus({ preventScroll: true });
      setFromPointer(event.clientX);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    if (!g.dragging) {
      const dx = Math.abs(event.clientX - g.startX);
      const dy = Math.abs(event.clientY - g.startY);
      if (dx < TAP_SLOP_PX || dx <= dy) return;
      g.dragging = true;
      capture(event);
      inputRef.current?.focus({ preventScroll: true });
    }
    setFromPointer(event.clientX);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (!g.dragging) {
      const moved = Math.abs(event.clientX - g.startX) >= TAP_SLOP_PX || Math.abs(event.clientY - g.startY) >= TAP_SLOP_PX;
      if (moved) return;
      inputRef.current?.focus({ preventScroll: true });
      setFromPointer(event.clientX);
    }
    onChangeEnd?.(lastValue.current);
  };

  const style = { '--ui-range-p': String(rangeFraction(current, min, max)) } as CSSProperties;

  return (
    <div className={cx('ui-slider', `ui-slider--${size}`, disabled && 'ui-slider--disabled', className)}>
      <div className="ui-slider__top">
        <label htmlFor={inputId} className={cx('ui-slider__label', hideLabel && 'visually-hidden')}>
          {label}
        </label>
        <output htmlFor={inputId} className="ui-slider__value" aria-hidden="true">
          {display}
        </output>
      </div>
      <div className="ui-slider__row">
        {showSteppers && (
          <IconButton
            aria-label={format(common.slider.decrease, { label })}
            icon={<MinusIcon />}
            variant="secondary"
            size={size}
            disabled={disabled || current <= Math.min(min, max)}
            onClick={() => stepBy(-1)}
          />
        )}
        <div className="ui-slider__track" ref={trackRef} style={style}>
          <input
            ref={inputRef}
            id={inputId}
            type="range"
            className="ui-slider__input"
            min={min}
            max={max}
            step={step}
            value={current}
            disabled={disabled}
            aria-valuetext={display}
            onChange={(event) => emit(Number(event.currentTarget.value))}
          />
          <div
            className="ui-slider__hit"
            aria-hidden="true"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              gesture.current = null;
            }}
          />
        </div>
        {showSteppers && (
          <IconButton
            aria-label={format(common.slider.increase, { label })}
            icon={<PlusIcon />}
            variant="secondary"
            size={size}
            disabled={disabled || current >= Math.max(min, max)}
            onClick={() => stepBy(1)}
          />
        )}
      </div>
    </div>
  );
}
