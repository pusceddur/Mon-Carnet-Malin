import { useId, useRef, useState, type JSX, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { common } from '../../i18n/fr/common';
import { IconButton } from './IconButton';
import { cx } from './internal/cx';
import { CloseIcon } from './internal/icons';
import { ModalLayer } from './internal/ModalLayer';
import { sheetDragOffset, shouldDismissSwipe } from './internal/swipe';
import './BottomSheet.css';

export interface BottomSheetProps {
  open: boolean;
  /** Called on close button, Escape, overlay tap and swipe down. */
  onClose: () => void;
  /** Heading of the sheet (also its accessible name). */
  title: string;
  /** Keeps the title for assistive tech only. */
  hideTitle?: boolean;
  children: ReactNode;
  /** Sticky action row at the bottom (above the home indicator). */
  footer?: ReactNode;
  /** false: no overlay/Escape/swipe dismissal, no close button (the content must offer a way out). Default true. */
  dismissible?: boolean;
  /** Element focused on open (default: the sheet, so its title is read first). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** `auto` (default): as tall as the content · `tall`: nearly full height. */
  height?: 'auto' | 'tall';
  /** Parent area density (44px close button). Default `child`. */
  size?: 'child' | 'parent';
  className?: string;
}

interface DragState {
  pointerId: number;
  startY: number;
  startTime: number;
}

const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [role="button"], [role="switch"], [role="radio"]';

/** Modal panel sliding up from the bottom: focus trap, close by button, Escape, overlay or swipe down. */
export function BottomSheet({
  open,
  onClose,
  title,
  hideTitle = false,
  children,
  footer,
  dismissible = true,
  initialFocusRef,
  height = 'auto',
  size = 'child',
  className,
}: BottomSheetProps): JSX.Element | null {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Reset the drag offset whenever the sheet is (re)opened.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setDragY(0);
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dismissible || !open) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) return;
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startTime: event.timeStamp };
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail if the pointer is already gone.
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setDragY(sheetDragOffset(event.clientY - current.startY));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    const deltaY = event.clientY - current.startY;
    const sheetHeight = panelRef.current?.getBoundingClientRect().height ?? 0;
    if (!cancelled && shouldDismissSwipe(deltaY, event.timeStamp - current.startTime, sheetHeight)) {
      onClose();
      return;
    }
    setDragY(0);
  };

  return (
    <ModalLayer
      open={open}
      placement="bottom"
      labelledBy={titleId}
      onDismiss={dismissible ? onClose : undefined}
      initialFocusRef={initialFocusRef}
      panelRef={panelRef}
      panelClassName={cx('ui-sheet', `ui-sheet--${height}`, `ui-sheet--${size}`, className)}
      panelStyle={dragY > 0 ? { transform: `translate3d(0, ${dragY}px, 0)` } : undefined}
      panelProps={{ 'data-dragging': dragging ? '' : undefined }}
    >
      <div
        className={cx('ui-sheet__grab', dismissible && 'ui-sheet__grab--active')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, false)}
        onPointerCancel={(event) => endDrag(event, true)}
      >
        {dismissible && <div className="ui-sheet__handle" aria-hidden="true" />}
        <div className="ui-sheet__header">
          <h2 id={titleId} className={cx('ui-sheet__title', hideTitle && 'visually-hidden')}>
            {title}
          </h2>
          {dismissible && (
            <IconButton
              aria-label={common.close}
              icon={<CloseIcon />}
              size={size}
              variant="ghost"
              className="ui-sheet__close"
              onClick={onClose}
            />
          )}
        </div>
      </div>
      <div className="ui-sheet__body">{children}</div>
      {footer !== undefined && footer !== null && <div className="ui-sheet__footer">{footer}</div>}
    </ModalLayer>
  );
}
