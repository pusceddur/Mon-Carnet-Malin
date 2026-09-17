import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { common } from '../../i18n/fr/common';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { cx } from './internal/cx';
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from './internal/icons';
import { PERSISTENT_ATTR } from './internal/ModalLayer';
import './Toast.css';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  /** Short French sentence. */
  message: string;
  /** Default `info`. */
  tone?: ToastTone;
  /** Auto-dismiss delay; `null` keeps the toast until closed. Default: 3 s success, 4 s info, 6 s warning/error. */
  durationMs?: number | null;
  /** One optional action (« Réessayer »). Tapping it also closes the toast. */
  action?: { label: string; onClick: () => void };
}

export interface ToastApi {
  /** Shows a toast and returns its id. An identical visible message is not duplicated. */
  show(options: ToastOptions | string): string;
  dismiss(id: string): void;
  info(message: string): string;
  success(message: string): string;
  warning(message: string): string;
  error(message: string): string;
}

interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
  action: ToastOptions['action'];
}

const DEFAULT_DURATION: Readonly<Record<ToastTone, number>> = { info: 4000, success: 3000, warning: 6000, error: 6000 };

const noopApi: ToastApi = {
  show: () => '',
  dismiss: () => {},
  info: () => '',
  success: () => '',
  warning: () => '',
  error: () => '',
};

const ToastContext = createContext<ToastApi | null>(null);

export interface ToastProviderProps {
  children: ReactNode;
  /** Maximum toasts visible at once (oldest removed first). Default 3. */
  max?: number;
}

/** Hosts the toast stack (top of the screen, clear of the reader toolbars). Wrap the app once. */
export function ToastProvider({ children, max = 3 }: ToastProviderProps): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const itemsRef = useRef<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());
  const counter = useRef(0);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useLayoutEffect(() => {
    const el = document.createElement('div');
    el.setAttribute(PERSISTENT_ATTR, '');
    document.body.appendChild(el);
    setContainer(el);
    return () => {
      el.remove();
    };
  }, []);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) window.clearTimeout(timer);
      map.clear();
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    itemsRef.current = itemsRef.current.filter((item) => item.id !== id);
    setItems((list) => list.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastOptions | string): string => {
      const options: ToastOptions = typeof input === 'string' ? { message: input } : input;
      const tone = options.tone ?? 'info';
      const existing = itemsRef.current.find((item) => item.message === options.message && item.tone === tone);
      if (existing) return existing.id;

      counter.current += 1;
      const id = `toast-${counter.current}`;
      const item: ToastItem = { id, message: options.message, tone, action: options.action };
      itemsRef.current = [...itemsRef.current, item].slice(-Math.max(1, max));
      setItems((list) => [...list, item].slice(-Math.max(1, max)));

      const duration = options.durationMs === undefined ? DEFAULT_DURATION[tone] : options.durationMs;
      if (duration !== null && duration > 0) {
        timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
      }
      return id;
    },
    [dismiss, max],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      info: (message) => show({ message, tone: 'info' }),
      success: (message) => show({ message, tone: 'success' }),
      warning: (message) => show({ message, tone: 'warning' }),
      error: (message) => show({ message, tone: 'error' }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {container &&
        createPortal(
          <div className="ui-toasts" aria-live="polite" aria-atomic="false" aria-label={common.toast.regionLabel} role="region">
            {items.map((item) => (
              <div key={item.id} className={cx('ui-toast', `ui-toast--${item.tone}`)}>
                <span className="ui-toast__icon" aria-hidden="true">
                  <ToneIcon tone={item.tone} />
                </span>
                <p className="ui-toast__message">{item.message}</p>
                {item.action && (
                  <Button
                    variant="ghost"
                    size="child"
                    className="ui-toast__action"
                    onClick={() => {
                      item.action?.onClick();
                      dismiss(item.id);
                    }}
                  >
                    {item.action.label}
                  </Button>
                )}
                <IconButton
                  aria-label={common.toast.dismiss}
                  icon={<CloseIcon size={20} />}
                  size="child"
                  className="ui-toast__close"
                  onClick={() => dismiss(item.id)}
                />
              </div>
            ))}
          </div>,
          container,
        )}
    </ToastContext.Provider>
  );
}

function ToneIcon({ tone }: { tone: ToastTone }): JSX.Element {
  switch (tone) {
    case 'success':
      return <CheckIcon size={18} />;
    case 'warning':
    case 'error':
      return <AlertIcon size={18} />;
    default:
      return <InfoIcon size={18} />;
  }
}

/** Access the toast API. Outside a ToastProvider it returns a silent no-op API (never throws). */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? noopApi;
}
