import { Fragment, memo, type JSX } from 'react';
import type { BlockModel, SentenceModel } from './model';

function Sentence({ sentence }: { sentence: SentenceModel }): JSX.Element {
  return (
    <span className="rp-s" data-s={sentence.index}>
      {sentence.parts.map((part, i) =>
        part.kind === 'word'
          ? <span key={`w${part.word.offset}`} className="rp-w" data-o={part.word.offset}>{part.word.text}</span>
          : <Fragment key={`t${i}`}>{part.text}</Fragment>,
      )}
    </span>
  );
}

/**
 * One text block, DOM exactly as §11.3. Memoized on (page, block, hash): highlights, selection and the sentence being read
 * are applied as attributes/classes afterwards, never by re-rendering the spans.
 */
export const ReaderBlock = memo(
  function ReaderBlock({ block }: { block: BlockModel }): JSX.Element {
    const title = block.kind === 'title';
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
            : <Sentence key={`s${segment.sentence.index}`} sentence={segment.sentence} />,
        )}
      </div>
    );
  },
  (a, b) => a.block.pageIndex === b.block.pageIndex && a.block.blockIndex === b.block.blockIndex && a.block.hash === b.block.hash
    && a.block.kind === b.block.kind && a.block.text === b.block.text,
);
