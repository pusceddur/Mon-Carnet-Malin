import { CODING_CHANGED, CODING_SILENT, CODING_SOUND, CODING_SOUND_ALT, codeFrenchTextCached, type TextCoding } from '@aide/shared';
import { Fragment, memo, type JSX, type ReactNode } from 'react';
import type { BlockModel, SentenceModel, WordModel } from './model';
import './aids.css';

/** §26 class of one coded letter: syllable colour, silent, sound group, changed sound (shown only when the aid is on). */
function letterClass(coding: TextCoding, i: number): string {
  const syllable = coding.syllable[i] ?? -1;
  if (syllable < 0) return '';
  const f = coding.flags[i] ?? 0;
  let name = syllable % 2 === 0 ? 'rp-y0' : 'rp-y1';
  if (f & CODING_SILENT) name += ' rp-mu';
  if (f & CODING_SOUND) name += f & CODING_SOUND_ALT ? ' rp-so rp-so2' : ' rp-so';
  if (f & CODING_CHANGED) name += ' rp-cg';
  return name;
}

/** The letters of a word in runs of the same marks (the word keeps exactly its text). */
function codedWord(word: WordModel, coding: TextCoding): ReactNode[] {
  const runs: ReactNode[] = [];
  let start = word.offset;
  let current = letterClass(coding, start);
  for (let i = word.offset + 1; i <= word.end; i++) {
    const name = i < word.end ? letterClass(coding, i) : null;
    if (name === current) continue;
    const text = word.text.slice(start - word.offset, i - word.offset);
    runs.push(current ? <span key={start} className={current}>{text}</span> : text);
    start = i;
    current = name ?? '';
  }
  return runs;
}

/** Text between words, with the arc of a liaison under its space. */
function withLiaisons(text: string, start: number, coding: TextCoding): ReactNode {
  const inside = coding.liaisons.filter((index) => index >= start && index < start + text.length);
  if (inside.length === 0) return text;
  const out: ReactNode[] = [];
  let cursor = start;
  for (const index of inside) {
    if (index > cursor) out.push(text.slice(cursor - start, index - start));
    out.push(<span key={index} className="rp-li">{text[index - start]}</span>);
    cursor = index + 1;
  }
  if (cursor < start + text.length) out.push(text.slice(cursor - start));
  return out;
}

function Sentence({ sentence, coding }: { sentence: SentenceModel; coding: TextCoding | null }): JSX.Element {
  let cursor = sentence.start;
  return (
    <span className="rp-s" data-s={sentence.index}>
      {sentence.parts.map((part, i) => {
        if (part.kind === 'word') {
          cursor = part.word.end;
          return (
            <span key={`w${part.word.offset}`} className="rp-w" data-o={part.word.offset}>
              {coding ? codedWord(part.word, coding) : part.word.text}
            </span>
          );
        }
        const start = cursor;
        cursor += part.text.length;
        return <Fragment key={`t${i}`}>{coding ? withLiaisons(part.text, start, coding) : part.text}</Fragment>;
      })}
    </span>
  );
}

/**
 * One text block, DOM exactly as §11.3. Memoized on (page, block, hash): highlights, selection and the sentence being read
 * are applied as attributes/classes afterwards, never by re-rendering the spans. `coded` (§26): the letters of each word
 * carry the marks of the reading aids; the aids shown are chosen with classes on the reader.
 */
export const ReaderBlock = memo(
  function ReaderBlock({ block, coded = false }: { block: BlockModel; coded?: boolean }): JSX.Element {
    const title = block.kind === 'title';
    const coding = coded ? codeFrenchTextCached(block.text) : null;
    return (
      <div
        className={title ? 'rp-block rp-block--title' : 'rp-block'}
        data-page-index={block.pageIndex}
        data-block-index={block.blockIndex}
        data-block-hash={block.hash}
        role={title ? 'heading' : undefined}
        aria-level={title ? 2 : undefined}
      >
        {block.segments.map((segment, i) =>
          segment.kind === 'gap'
            ? <Fragment key={`g${i}`}>{segment.text}</Fragment>
            : <Sentence key={`s${segment.sentence.index}`} sentence={segment.sentence} coding={coding} />,
        )}
      </div>
    );
  },
  (a, b) => a.block.pageIndex === b.block.pageIndex && a.block.blockIndex === b.block.blockIndex && a.block.hash === b.block.hash
    && a.block.kind === b.block.kind && a.block.text === b.block.text && (a.coded ?? false) === (b.coded ?? false),
);
