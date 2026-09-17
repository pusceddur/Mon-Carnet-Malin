import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { getFocusable, prefersReducedMotion } from './focus';
import './ModalLayer.css';

/** Duration of the closing animation (keep in sync with --dur in tokens.css). */
export const LAYER_EXIT_MS = 180;

/** Attribute for body-level nodes that must stay interactive while a modal layer is open (toasts). */
export const PERSISTENT_ATTR = 'data-ui-persistent';

const layerStack: string[] = [];
let scrollLocks = 0;
let savedOverflow = '';
let layerCounter = 0;

function lockScroll(): void {
  if (scrollLocks++ === 0) {
    const style = document.documentElement.style;
    savedOverflow = style.overflow;
    style.overflow = 'hidden';
  }
}

function unlockScroll(): void {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.documentElement.style.overflow = savedOverflow;
}

/** Marks every other body child inert; returns the undo function (restores only what it changed). */
function inertBackground(container: HTMLElement): () => void {
  const changed: Element[] = [];
  for (const el of Array.from(document.body.children)) {
    if (el === container || el.hasAttribute(PERSISTENT_ATTR) || el.hasAttribute('inert') || el.tagName === 'SCRIPT') continue;
    el.setAttribute('inert', '');
    changed.push(el);
  }
  return () => {
    for (const el of changed) el.removeAttribute('inert');
  };
}

/** Keeps a component mounted during its exit animation. */
export function usePresence(open: boolean, exitMs: number = LAYER_EXIT_MS): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return undefined;
    const timer = window.setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : exitMs);
    return () => window.clearTimeout(timer);
  }, [open, mounted, exitMs]);

  return { mounted: open || mounted, closing: !open && mounted };
}

export interface ModalLayerProps {
  open: boolean;
  placement: 'bottom' | 'center';
  role?: 'dialog' | 'alertdialog';
  labelledBy: string;
  describedBy?: string;
  /** Called on Escape and overlay tap. Omit to make the layer non-dismissible. */
  onDismiss?: () => void;
  /** Element focused on open (default: the panel itself). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  panelRef?: RefObject<HTMLDivElement | null>;
  panelClassName?: string;
  panelStyle?: CSSProperties;
  panelProps?: Record<`data-${string}`, string | undefined>;
  children: ReactNode;
}

/** Portal + overlay + focus trap + inert background + scroll lock + Escape. Shared by BottomSheet and ConfirmDialog. */
export function ModalLayer(props: ModalLayerProps): JSX.Element | null {
  const { mounted, closing } = usePresence(props.open);
  if (!mounted) return null;
  return <LayerPortal {...props} closing={closing} />;
}

function LayerPortal({
  placement,
  role = 'dialog',
  labelledBy,
  describedBy,
  onDismiss,
  initialFocusRef,
  panelRef: externalPanelRef,
  panelClassName,
  panelStyle,
  panelProps,
  children,
  closing,
}: ModalLayerProps & { closing: boolean }): JSX.Element | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const ownPanelRef = useRef<HTMLDivElement | null>(null);
  const panelRef = externalPanelRef ?? ownPanelRef;
  const [layerId] = useState(() => `ui-layer-${++layerCounter}`);
  const dismissRef = useRef(onDismiss);
  const closingRef = useRef(closing);

  useLayoutEffect(() => {
    dismissRef.current = onDismiss;
    closingRef.current = closing;
  });

  useLayoutEffect(() => {
    const el = document.createElement('div');
    el.className = 'ui-layer-root';
    document.body.appendChild(el);
    setContainer(el);
    return () => {
      el.remove();
    };
  }, []);

  useEffect(() => {
    if (!container) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    layerStack.push(layerId);
    lockScroll();
    const restoreInert = inertBackground(container);

    const panel = panelRef.current;
    const initial = initialFocusRef?.current ?? panel;
    initial?.focus({ preventScroll: true });

    const isTop = (): boolean => layerStack[layerStack.length - 1] === layerId;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isTop() || !panel) return;
      if (event.key === 'Escape') {
        const dismiss = dismissRef.current;
        if (dismiss && !closingRef.current) {
          event.preventDefault();
          dismiss();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable(panel);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (event: FocusEvent): void => {
      if (!isTop() || !panel) return;
      const target = event.target;
      if (!(target instanceof Node) || container.contains(target)) return;
      if (target instanceof Element && target.closest(`[${PERSISTENT_ATTR}]`)) return;
      panel.focus({ preventScroll: true });
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      const index = layerStack.lastIndexOf(layerId);
      if (index >= 0) layerStack.splice(index, 1);
      restoreInert();
      unlockScroll();
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
    // Set up once per mount: panelRef and initialFocusRef are refs, callbacks are read through refs.
  }, [container, layerId]);

  if (!container) return null;

  return createPortal(
    <div className={cx('ui-layer', `ui-layer--${placement}`)} data-state={closing ? 'closing' : 'open'}>
      <div
        className="ui-layer__overlay"
        aria-hidden="true"
        onClick={() => {
          if (onDismiss && !closing) onDismiss();
        }}
      />
      <div
        {...panelProps}
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cx('ui-layer__panel', panelClassName)}
        style={panelStyle}
      >
        {children}
      </div>
    </div>,
    container,
  );
}
