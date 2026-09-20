import type { ReadingPreferences } from '@aide/shared';
import { useMemo, type JSX } from 'react';
import { readingFontClass, readingStyleVars } from '../../design/reading';
import { hasReadingAids, readingAidClasses, readingAidsOf } from './aids';
import { buildBlockModel } from './model';
import { ReaderBlock } from './ReaderBlock';

/** Sample text drawn like the reader: font, spaces and §26 couleurs de lecture. */
export function ReadingPreview({ text, reading, className }: { text: string; reading: ReadingPreferences; className?: string }): JSX.Element {
  const block = useMemo(() => buildBlockModel(0, 0, { kind: 'paragraph', text }, 'preview'), [text]);
  const aids = readingAidsOf(reading);
  const classes = ['reading', readingFontClass(reading.font), ...readingAidClasses(aids), className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={classes} style={readingStyleVars(reading)} aria-hidden="true">
      <ReaderBlock block={block} coded={hasReadingAids(aids)} />
    </div>
  );
}
