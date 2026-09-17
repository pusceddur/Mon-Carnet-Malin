import type { JSX } from 'react';
import { BottomSheet, Button } from '../../design/components';
import { reader } from '../../i18n/fr/reader';

export interface ReaderMenuProps {
  open: boolean;
  view: 'text' | 'original';
  onClose(): void;
  onQuestion(): void;
  onExercises(): void;
  onSummary(): void;
  /** Absent when the document has no original pages (EPUB). */
  onToggleView?: () => void;
}

/** ⋯ menu: ❓ question on the text · 🧠 exercises · 📝 summary · 🖼️ original / 📖 text. */
export function ReaderMenu({ open, view, onClose, onQuestion, onExercises, onSummary, onToggleView }: ReaderMenuProps): JSX.Element | null {
  const m = reader.menu;
  return (
    <BottomSheet open={open} onClose={onClose} title={m.title}>
      <div className="rd-menu">
        <Button variant="secondary" block onClick={onQuestion}>{m.question}</Button>
        <Button variant="secondary" block onClick={onExercises}>{m.exercises}</Button>
        <Button variant="secondary" block onClick={onSummary}>{m.summary}</Button>
        {onToggleView && <Button variant="secondary" block onClick={onToggleView}>{view === 'text' ? m.showOriginal : m.showText}</Button>}
      </div>
    </BottomSheet>
  );
}
