import type { JSX } from 'react';
import { Button, IconButton } from '../../design/components';
import { reader } from '../../i18n/fr/reader';

export interface SelectionToolbarProps {
  text: string;
  /** 📖 Définition only for a single word. */
  canDefine: boolean;
  highlighted: boolean;
  canExtendPrevious: boolean;
  canExtendNext: boolean;
  wholeSentence: boolean;
  wholeParagraph: boolean;
  onRead(): void;
  onDefine(): void;
  onExplain(): void;
  onSimplify(): void;
  onHighlight(): void;
  onPreviousWord(): void;
  onNextWord(): void;
  onSentence(): void;
  onParagraph(): void;
  onClose(): void;
}

const PREVIEW_MAX = 90;

function preview(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > PREVIEW_MAX ? `${clean.slice(0, PREVIEW_MAX - 1)}…` : clean;
}

/** Fixed panel at the bottom (§15.7): actions on the selected text + extension of the selection. */
export function SelectionToolbar(props: SelectionToolbarProps): JSX.Element {
  const s = reader.selection;
  return (
    <section className="rd-selbar" aria-label={s.toolbarLabel}>
      <div className="rd-selbar__head">
        <p className="rd-selbar__text" aria-live="polite">« {preview(props.text)} »</p>
        <IconButton aria-label={s.close} icon="✕" onClick={props.onClose} />
      </div>
      <div className="rd-selbar__actions">
        <Button variant="secondary" icon="🔊" onClick={props.onRead}>{s.read}</Button>
        {props.canDefine && <Button variant="secondary" icon="📖" onClick={props.onDefine}>{s.definition}</Button>}
        <Button variant="primary" icon="💡" onClick={props.onExplain}>{s.explain}</Button>
        <Button variant="secondary" icon="✨" onClick={props.onSimplify}>{s.simplify}</Button>
        {props.highlighted
          ? <Button variant="secondary" icon="🧽" aria-label={s.unhighlightLabel} onClick={props.onHighlight}>{s.unhighlight}</Button>
          : <Button variant="secondary" icon="🖍️" onClick={props.onHighlight}>{s.highlight}</Button>}
      </div>
      <div className="rd-selbar__extend">
        <Button variant="ghost" aria-label={s.previousWordLabel} disabled={!props.canExtendPrevious} onClick={props.onPreviousWord}>{s.previousWord}</Button>
        <Button variant="ghost" aria-label={s.nextWordLabel} disabled={!props.canExtendNext} onClick={props.onNextWord}>{s.nextWord}</Button>
        <Button variant="ghost" aria-pressed={props.wholeSentence} onClick={props.onSentence}>{s.sentence}</Button>
        <Button variant="ghost" aria-pressed={props.wholeParagraph} onClick={props.onParagraph}>{s.paragraph}</Button>
      </div>
    </section>
  );
}
