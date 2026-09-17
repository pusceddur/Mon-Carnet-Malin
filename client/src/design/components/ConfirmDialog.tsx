import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react';
import { common } from '../../i18n/fr/common';
import { Button } from './Button';
import { cx } from './internal/cx';
import { ModalLayer } from './internal/ModalLayer';
import './ConfirmDialog.css';

export interface ConfirmDialogProps {
  open: boolean;
  /** Question asked (« Supprimer ce livre ? »). */
  title: string;
  /** Consequence in one or two short sentences. */
  message?: ReactNode;
  /** Default « Valider ». Name the action (« Supprimer »). */
  confirmLabel?: string;
  /** Default « Annuler ». */
  cancelLabel?: string;
  /** `danger` paints the confirm button red and focuses Cancel first. Default `default`. */
  tone?: 'default' | 'danger';
  /** Shows a spinner on the confirm button and blocks dismissal. Set automatically while `onConfirm` returns a pending promise. */
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  /** Cancel button, Escape and overlay tap. */
  onCancel: () => void;
  /** Default `child`. */
  size?: 'child' | 'parent';
}

/** Centered confirmation (role alertdialog). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = common.validate,
  cancelLabel = common.cancel,
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
  size = 'child',
}: ConfirmDialogProps): JSX.Element | null {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const working = busy || pending;

  const handleConfirm = (): void => {
    if (working) return;
    const result = onConfirm();
    if (result instanceof Promise) {
      setPending(true);
      result.then(
        () => {
          if (mounted.current) setPending(false);
        },
        () => {
          if (mounted.current) setPending(false);
        },
      );
    }
  };

  return (
    <ModalLayer
      open={open}
      placement="center"
      role="alertdialog"
      labelledBy={titleId}
      describedBy={message !== undefined && message !== null ? messageId : undefined}
      onDismiss={working ? undefined : onCancel}
      initialFocusRef={tone === 'danger' ? cancelRef : confirmRef}
      panelClassName={cx('ui-dialog', `ui-dialog--${size}`)}
    >
      <h2 id={titleId} className="ui-dialog__title">
        {title}
      </h2>
      {message !== undefined && message !== null && (
        <div id={messageId} className="ui-dialog__message">
          {message}
        </div>
      )}
      <div className="ui-dialog__actions">
        <Button
          ref={confirmRef}
          variant={tone === 'danger' ? 'danger' : 'primary'}
          size={size}
          loading={working}
          onClick={handleConfirm}
        >
          {confirmLabel}
        </Button>
        <Button ref={cancelRef} variant="secondary" size={size} disabled={working} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </ModalLayer>
  );
}
