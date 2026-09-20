import type { Id, PageContent } from '@aide/shared';
import { useEffect, useLayoutEffect, useRef, useState, type JSX, type PointerEvent } from 'react';
import { fetchPageImage } from '../../api/documents';
import { db } from '../../db/localDb';
import { EmptyState, IconButton, MinusIcon, PlusIcon, Spinner } from '../../design/components';
import { format } from '../../i18n/fr';
import { pencil as pencilStrings } from '../../i18n/fr/pencil';
import { reader } from '../../i18n/fr/reader';
import { InkLayer, TextBoxLayer, usePencilStore } from '../../pencil';
import { isOnline } from '../../platform/online';

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.5;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return ZOOM_MIN;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) * 100) / 100;
}

type ImageState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; url: string; width: number | null; height: number | null };

export interface OriginalPageViewProps {
  documentId: Id;
  childId: Id;
  pageIndex: number;
  page: PageContent | null;
  layoutKey: string;
  /** Opens with « Écrire du texte » already on (homework, §19.3). */
  startWriting?: boolean;
}

const zoomFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/**
 * Page image in color (§19.1; grayscale for pages processed before), local copy or downloaded on demand, with 1×–3× zoom,
 * ink and text boxes (§19.2) in normalized coordinates.
 */
export function OriginalPageView({ documentId, childId, pageIndex, page, layoutKey, startWriting = false }: OriginalPageViewProps): JSX.Element {
  const [image, setImage] = useState<ImageState>({ status: 'loading' });
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [writing, setWriting] = useState(startWriting);
  const [frameWidth, setFrameWidth] = useState(0);
  const pencilMode = usePencilStore((st) => st.mode);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const previousZoom = useRef(zoom);
  const pageRef = useRef(page);
  pageRef.current = page;

  // The image exists once the page has been processed (a sheet opened right after its import).
  const processed = page !== null && page.width !== null;
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setImage({ status: 'loading' });
    setNatural(null);
    setZoom(ZOOM_MIN);
    void (async () => {
      let blob: Blob | null = null;
      // Page dimensions only matter for the first paint: a page row update must not reload the image.
      let width = pageRef.current?.width ?? null;
      let height = pageRef.current?.height ?? null;
      try {
        // §19.1: the color copy (same frame as the OCR image); pages processed before it only have the grayscale one.
        const record = (await db.pageImages.get([documentId, pageIndex, 'color'])) ?? (await db.pageImages.get([documentId, pageIndex, 'ocr']));
        if (record) {
          blob = record.blob;
          width = record.width;
          height = record.height;
        }
      } catch {
        blob = null;
      }
      if (!blob && isOnline()) {
        try {
          blob = await fetchPageImage(documentId, pageIndex);
        } catch {
          blob = null;
        }
      }
      if (cancelled) return;
      if (!blob) {
        setImage({ status: 'missing' });
        return;
      }
      url = URL.createObjectURL(blob);
      setImage({ status: 'ready', url, width, height });
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [documentId, pageIndex, processed]);

  // Drawing and writing text are two separate tools: taking a pencil ends the writing, and the other way round.
  const previousPencilMode = useRef(pencilMode);
  useEffect(() => {
    if (startWriting) usePencilStore.getState().setMode('lecture');
  }, []);
  useEffect(() => {
    if (previousPencilMode.current !== 'annotation' && pencilMode === 'annotation') setWriting(false);
    previousPencilMode.current = pencilMode;
  }, [pencilMode]);
  const toggleWriting = (): void => {
    if (!writing) usePencilStore.getState().setMode('lecture');
    setWriting(!writing);
  };

  // Width of the page in px: font size of the text boxes (follows the zoom and the window).
  const imageReady = image.status === 'ready';
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    setFrameWidth(frame.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setFrameWidth(frame.getBoundingClientRect().width));
    observer.observe(frame);
    return () => observer.disconnect();
  }, [imageReady, zoom]);

  // Keep the visual centre when the zoom changes.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const before = previousZoom.current;
    previousZoom.current = zoom;
    if (!viewport || before === zoom) return;
    const ratio = zoom / before;
    const cx = viewport.scrollLeft + viewport.clientWidth / 2;
    const cy = viewport.scrollTop + viewport.clientHeight / 2;
    viewport.scrollLeft = cx * ratio - viewport.clientWidth / 2;
    viewport.scrollTop = cy * ratio - viewport.clientHeight / 2;
  }, [zoom]);

  const distance = (): number => {
    const [a, b] = Array.from(pointers.current.values());
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType !== 'touch') return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) pinch.current = { distance: distance(), zoom };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = pinch.current;
    if (start && pointers.current.size === 2 && start.distance > 0) setZoom(clampZoom(start.zoom * (distance() / start.distance)));
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const o = reader.original;
  if (image.status === 'loading') {
    return (
      <div className="rd-original rd-original--center">
        <Spinner label={o.loading} />
      </div>
    );
  }
  if (image.status === 'missing') {
    return (
      <div className="rd-original rd-original--center">
        <EmptyState emoji="🖼️" title={o.unavailable} />
      </div>
    );
  }

  const width = image.width ?? natural?.width ?? null;
  const height = image.height ?? natural?.height ?? null;
  return (
    <div className="rd-original">
      <div className="rd-original__tools" role="group" aria-label={o.title}>
        <IconButton aria-label={o.zoomOut} icon={<MinusIcon />} variant="secondary" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))} />
        <button type="button" className="rd-original__zoom" aria-label={o.zoomReset} onClick={() => setZoom(ZOOM_MIN)}>
          {format(o.zoomValue, { value: zoomFormat.format(zoom) })}
        </button>
        <IconButton aria-label={o.zoomIn} icon={<PlusIcon />} variant="secondary" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))} />
        <span className="rd-original__sep" aria-hidden="true" />
        <IconButton aria-label={pencilStrings.textBox.tool} icon="📝" variant="secondary" pressed={writing} onClick={toggleWriting} />
      </div>
      {writing && (
        <p className="rd-original__hint" role="status">
          {pencilStrings.textBox.toolHint}
        </p>
      )}
      <div
        ref={viewportRef}
        className="rd-original__viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div ref={frameRef} className="rd-original__frame" style={{ width: `${zoom * 100}%` }}>
          <img
            className="rd-original__img"
            src={image.url}
            alt={format(o.alt, { page: pageIndex + 1 })}
            width={width ?? undefined}
            height={height ?? undefined}
            draggable={false}
            onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          />
          {width !== null && height !== null && (
            <InkLayer
              documentId={documentId}
              childId={childId}
              view="original"
              pageIndex={pageIndex}
              containerRef={frameRef}
              imageSize={{ width, height }}
              layoutKey={`${layoutKey}|z${zoom}`}
            />
          )}
          {width !== null && height !== null && frameWidth > 0 && (
            <TextBoxLayer
              documentId={documentId}
              childId={childId}
              pageIndex={pageIndex}
              frameRef={frameRef}
              frameWidth={frameWidth}
              editing={writing}
              readable={pencilMode === 'lecture'}
            />
          )}
        </div>
      </div>
    </div>
  );
}
