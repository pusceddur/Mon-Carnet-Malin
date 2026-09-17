// Page image with an optional 4-corner frame (normalized coordinates), corners dragged with pointer events.
import { useRef, type JSX, type KeyboardEvent, type PointerEvent } from 'react';
import { documents as t } from '../../i18n/fr/documents';

export type NormalizedQuad = [number, number][];

export const FULL_FRAME: NormalizedQuad = [[0, 0], [1, 0], [1, 1], [0, 1]];

const CORNER_LABELS = [t.editor.corners.topLeft, t.editor.corners.topRight, t.editor.corners.bottomRight, t.editor.corners.bottomLeft];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Moves one corner, keeping coordinates inside the image. */
export function moveCorner(quad: NormalizedQuad, index: number, x: number, y: number): NormalizedQuad {
  return quad.map((p, i) => (i === index ? [clamp01(x), clamp01(y)] : [p[0], p[1]]));
}

export interface QuadEditorProps {
  imageUrl: string;
  alt: string;
  quad: NormalizedQuad | null;
  editing: boolean;
  onChange: (quad: NormalizedQuad) => void;
}

export function QuadEditor({ imageUrl, alt, quad, editing, onChange }: QuadEditorProps): JSX.Element {
  const container = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<{ index: number; pointerId: number } | null>(null);
  const current = quad ?? FULL_FRAME;
  const showFrame = editing || quad !== null;

  const pointFromEvent = (event: PointerEvent<HTMLElement>): [number, number] | null => {
    const rect = container.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, index: number): void => {
    event.preventDefault();
    event.currentTarget.focus();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best effort (synthetic events).
    }
    dragging.current = { index, pointerId: event.pointerId };
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>, index: number): void => {
    const drag = dragging.current;
    if (!drag || drag.index !== index || drag.pointerId !== event.pointerId) return;
    const point = pointFromEvent(event);
    if (point) onChange(moveCorner(current, index, point[0], point[1]));
  };

  const onPointerEnd = (event: PointerEvent<HTMLButtonElement>): void => {
    if (dragging.current?.pointerId !== event.pointerId) return;
    dragging.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const p = current[index]!;
    onChange(moveCorner(current, index, p[0] + delta[0], p[1] + delta[1]));
  };

  const points = current.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <div className={`quad-editor${editing ? ' quad-editor--editing' : ''}`} ref={container}>
      <img className="quad-editor__image" src={imageUrl} alt={alt} draggable={false} />
      {showFrame && (
        <svg className="quad-editor__overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path className="quad-editor__shade" fillRule="evenodd" d={`M0,0 H1 V1 H0 Z M${current.map(([x, y]) => `${x},${y}`).join(' L')} Z`} />
          <polygon className="quad-editor__frame" points={points} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {editing &&
        current.map(([x, y], index) => (
          <button
            key={CORNER_LABELS[index]}
            type="button"
            className="quad-editor__handle"
            style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
            aria-label={`${CORNER_LABELS[index]} — ${t.editor.cornerHint}`}
            onPointerDown={(e) => onPointerDown(e, index)}
            onPointerMove={(e) => onPointerMove(e, index)}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            <span className="quad-editor__dot" aria-hidden="true" />
          </button>
        ))}
    </div>
  );
}
