// STUB: client-pencil
import type { Id } from '@aide/shared';
import type { JSX, RefObject } from 'react';

/** view 'text': absolute overlay over .rp-page (anchored to .rp-w); view 'original': overlay over the page image. */
export function InkLayer(props: { documentId: Id; childId: Id; view: 'text' | 'original'; pageIndex: number; containerRef: RefObject<HTMLElement | null>; imageSize?: { width: number; height: number } }): JSX.Element {
  return <svg className="ink-layer" data-view={props.view} data-page-index={props.pageIndex} aria-hidden="true" />;
}
