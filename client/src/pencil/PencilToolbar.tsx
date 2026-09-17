// Floating annotation toolbar (bottom centre): ✏️ 🖊️ 🖍️ 🧽 ↩️ ↪️ 🎨 ⋯ with colour/thickness popover and options menu.
import type { EraserMode, Thickness } from '@aide/shared';
import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton, Segmented, Toggle, useToast } from '../design/components';
import { pencil as strings } from '../i18n/fr/pencil';
import { startPencilPreferences } from './preferences';
import { usePencilStore, type PencilState } from './store';
import { ACTION_ICONS, COLOR_LABELS, ERASER_MODES, INK_TOOLS, THICKNESSES, TOOL_ICONS, paletteFor } from './Tools';
import './pencil.css';

type Popover = 'colors' | 'more' | null;

const ERASER_MODE_ICONS: Readonly<Record<EraserMode, string>> = { stroke: '🧽', partial: '✂️', page: '🗑️' };
/** Preview dot of fin / moyen / épais. */
const THICKNESS_DOT_PX = [8, 14, 22] as const;
const ERASER_MODE_HINTS: Readonly<Record<EraserMode, string>> = {
  stroke: strings.eraser.strokeHint,
  partial: strings.eraser.partialHint,
  page: strings.eraser.pageHint,
};

function toolLabel(tool: PencilState['tool']): string {
  return strings.toolbar[tool];
}

export function PencilToolbar(): JSX.Element {
  const mode = usePencilStore((s) => s.mode);
  if (mode !== 'annotation' || typeof document === 'undefined') return <></>;
  return createPortal(<ToolbarContent />, document.body);
}

function ToolbarContent(): JSX.Element {
  const tool = usePencilStore((s) => s.tool);
  const lastInkTool = usePencilStore((s) => s.lastInkTool);
  const color = usePencilStore((s) => s.color);
  const thickness = usePencilStore((s) => s.thickness);
  const eraserMode = usePencilStore((s) => s.eraserMode);
  const fingerDraws = usePencilStore((s) => s.fingerDraws);
  const canUndo = usePencilStore((s) => s.canUndo);
  const canRedo = usePencilStore((s) => s.canRedo);
  const historyError = usePencilStore((s) => s.historyError);
  const actions = usePencilStore.getState();
  const toast = useToast();

  const [popover, setPopover] = useState<Popover>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const colorsButton = useRef<HTMLButtonElement | null>(null);
  const moreButton = useRef<HTMLButtonElement | null>(null);
  const colorsId = useId();
  const moreId = useId();

  useEffect(() => {
    void startPencilPreferences();
  }, []);

  useEffect(() => {
    if (!historyError) return;
    toast.error(strings.errors.undoFailed);
    usePencilStore.setState({ historyError: false });
  }, [historyError, toast]);

  useEffect(() => {
    if (popover === null) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setPopover(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const trigger = popover === 'colors' ? colorsButton.current : moreButton.current;
      setPopover(null);
      trigger?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [popover]);

  const toggle = (next: Exclude<Popover, null>): void => setPopover((current) => (current === next ? null : next));

  const selectTool = (next: PencilState['tool']): void => {
    if (next === tool) {
      toggle(next === 'eraser' ? 'more' : 'colors');
      return;
    }
    actions.setTool(next);
    setPopover(null);
  };

  const palette = paletteFor(lastInkTool);
  const thicknessOptions = THICKNESSES.map((t: Thickness, index) => ({
    value: t,
    label: strings.thickness[t],
    icon: <span className="pencil-thickness-dot" style={{ width: THICKNESS_DOT_PX[index], height: THICKNESS_DOT_PX[index] }} />,
  }));

  let panel: ReactNode = null;
  if (popover === 'colors') {
    panel = (
      <div id={colorsId} role="dialog" aria-label={strings.toolbar.colors} className="pencil-popover">
        <section className="pencil-popover__section">
          <h2 className="pencil-popover__title" id={`${colorsId}-color`}>
            {strings.colors.title}
          </h2>
          <div role="radiogroup" aria-labelledby={`${colorsId}-color`} className="pencil-swatches">
            {palette.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === color}
                aria-label={COLOR_LABELS[c] ?? c}
                className="pencil-swatch"
                style={{ backgroundColor: c }}
                onClick={() => {
                  actions.setColor(c);
                  if (tool === 'eraser') actions.setTool(lastInkTool);
                }}
              />
            ))}
          </div>
        </section>
        <section className="pencil-popover__section">
          <Segmented<Thickness>
            label={strings.thickness.title}
            value={thickness}
            options={thicknessOptions}
            onChange={(t) => {
              actions.setThickness(t);
              if (tool === 'eraser') actions.setTool(lastInkTool);
            }}
          />
        </section>
      </div>
    );
  } else if (popover === 'more') {
    panel = (
      <div id={moreId} role="dialog" aria-label={strings.more.title} className="pencil-popover">
        <section className="pencil-popover__section">
          <h2 className="pencil-popover__title" id={`${moreId}-eraser`}>
            {strings.eraser.title}
          </h2>
          <div role="radiogroup" aria-labelledby={`${moreId}-eraser`} className="pencil-menu">
            {ERASER_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={eraserMode === m}
                className="pencil-menu__option"
                onClick={() => {
                  actions.setEraserMode(m);
                  setPopover(null);
                }}
              >
                <span className="pencil-menu__icon" aria-hidden="true">
                  {ERASER_MODE_ICONS[m]}
                </span>
                <span>{strings.eraser[m]}</span>
              </button>
            ))}
          </div>
          <p className="pencil-hint">{ERASER_MODE_HINTS[eraserMode]}</p>
        </section>
        <section className="pencil-popover__section">
          <Toggle label={strings.more.fingerDraws} description={strings.more.fingerDrawsHint} checked={fingerDraws} onChange={actions.setFingerDraws} />
        </section>
        <section className="pencil-popover__section">
          <Button
            variant="secondary"
            block
            icon={ACTION_ICONS.read}
            onClick={() => {
              setPopover(null);
              actions.setMode('lecture');
            }}
          >
            {strings.more.backToReading}
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="pencil-toolbar">
      {panel}
      <div role="toolbar" aria-label={strings.toolbar.label} className="pencil-toolbar__bar">
        {INK_TOOLS.map((t) => (
          <IconButton key={t} className="pencil-tool" icon={TOOL_ICONS[t]} aria-label={toolLabel(t)} pressed={tool === t} onClick={() => selectTool(t)} />
        ))}
        <IconButton className="pencil-tool" icon={TOOL_ICONS.eraser} aria-label={toolLabel('eraser')} pressed={tool === 'eraser'} onClick={() => selectTool('eraser')} />
        <span className="pencil-toolbar__sep" aria-hidden="true" />
        <IconButton className="pencil-tool" icon={ACTION_ICONS.undo} aria-label={strings.toolbar.undo} disabled={!canUndo} onClick={() => actions.undo()} />
        <IconButton className="pencil-tool" icon={ACTION_ICONS.redo} aria-label={strings.toolbar.redo} disabled={!canRedo} onClick={() => actions.redo()} />
        <span className="pencil-toolbar__sep" aria-hidden="true" />
        <IconButton
          ref={colorsButton}
          className="pencil-tool"
          icon={
            <>
              {ACTION_ICONS.colors}
              <span className="pencil-tool__dot" style={{ backgroundColor: color }} />
            </>
          }
          aria-label={strings.toolbar.colors}
          aria-haspopup="dialog"
          aria-expanded={popover === 'colors'}
          aria-controls={popover === 'colors' ? colorsId : undefined}
          onClick={() => toggle('colors')}
        />
        <IconButton
          ref={moreButton}
          className="pencil-tool"
          icon={ACTION_ICONS.more}
          aria-label={strings.toolbar.more}
          aria-haspopup="dialog"
          aria-expanded={popover === 'more'}
          aria-controls={popover === 'more' ? moreId : undefined}
          onClick={() => toggle('more')}
        />
      </div>
    </div>
  );
}
