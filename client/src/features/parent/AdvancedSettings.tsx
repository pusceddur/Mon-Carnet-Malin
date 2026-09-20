import { useId, type JSX, type ReactNode } from 'react';
import { Button } from '../../design/components';

export interface AdvancedSettingsProps {
  label: string;
  hint?: string;
  open: boolean;
  onToggle(): void;
  children: ReactNode;
}

/** §27 « Réglages avancés »: the settings one by one, folded by default so that the page shows only the essentials. */
export function AdvancedSettings({ label, hint, open, onToggle, children }: AdvancedSettingsProps): JSX.Element {
  const bodyId = useId();
  return (
    <div className="advanced-settings">
      <Button variant="secondary" size="parent" icon="⚙️" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        {label}
      </Button>
      {hint && !open && <p className="parent-section__hint">{hint}</p>}
      <div id={bodyId} className="advanced-settings__body" hidden={!open}>
        {open && children}
      </div>
    </div>
  );
}
