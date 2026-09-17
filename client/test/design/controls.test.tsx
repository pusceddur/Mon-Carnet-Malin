import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Field, IconButton, ProgressBar, Segmented, Select, Slider, TextInput, Toggle, progressPercent } from '../../src/design/components';
import { rangeFraction, snapToStep, valueFromPointer } from '../../src/design/components/internal/range';
import { format } from '../../src/i18n/fr';
import { common } from '../../src/i18n/fr/common';
import { allByRole, buttonByName, byRole, cleanup, click, keyDown, pointer, render } from './render';

describe('Toggle', () => {
  afterEach(cleanup);

  function ControlledToggle({ onChange }: { onChange: (v: boolean) => void }): JSX.Element {
    const [on, setOn] = useState(false);
    return (
      <Toggle
        label="Surligner la phrase lue"
        description="La phrase écoutée est colorée."
        checked={on}
        onChange={(v) => {
          onChange(v);
          setOn(v);
        }}
      />
    );
  }

  it('is a labelled switch that flips on tap', async () => {
    const onChange = vi.fn();
    await render(<ControlledToggle onChange={onChange} />);
    const toggle = byRole('switch') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById(toggle.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Surligner la phrase lue');
    expect(document.getElementById(toggle.getAttribute('aria-describedby') ?? '')?.textContent).toBe('La phrase écoutée est colorée.');

    await click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('does nothing when disabled', async () => {
    const onChange = vi.fn();
    await render(<Toggle label="Mode" checked onChange={onChange} disabled />);
    await click(byRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Button and IconButton', () => {
  afterEach(cleanup);

  it('defaults to type=button and ignores clicks while loading', async () => {
    const onClick = vi.fn();
    const view = await render(<Button onClick={onClick}>Enregistrer</Button>);
    const button = view.container.querySelector('button') as HTMLButtonElement;
    expect(button.type).toBe('button');
    await click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    await view.rerender(
      <Button onClick={onClick} loading>
        Enregistrer
      </Button>,
    );
    expect(button.getAttribute('aria-busy')).toBe('true');
    await click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes the aria-label and pressed state of icon buttons', async () => {
    await render(<IconButton aria-label="Surligneur" icon="🖍️" pressed />);
    const button = buttonByName('Surligneur');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.querySelector('[aria-hidden="true"]')?.textContent).toBe('🖍️');
  });
});

describe('Segmented', () => {
  afterEach(cleanup);

  function Theme({ onChange }: { onChange: (v: string) => void }): JSX.Element {
    const [value, setValue] = useState<'creme' | 'clair' | 'sombre'>('creme');
    return (
      <Segmented
        label="Couleur du fond"
        value={value}
        onChange={(v) => {
          onChange(v);
          setValue(v);
        }}
        options={[
          { value: 'creme', label: common.themes.creme },
          { value: 'clair', label: common.themes.clair, disabled: true },
          { value: 'sombre', label: common.themes.sombre },
        ]}
      />
    );
  }

  it('selects on tap and moves with arrow keys, skipping disabled options', async () => {
    const onChange = vi.fn();
    await render(<Theme onChange={onChange} />);
    const radios = allByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);

    radios[0]?.focus();
    await keyDown(radios[0] as HTMLElement, 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('sombre');
    expect(document.activeElement).toBe(radios[2]);
    expect(radios[2]?.getAttribute('aria-checked')).toBe('true');

    await click(radios[0]);
    expect(onChange).toHaveBeenLastCalledWith('creme');
    expect(byRole('radiogroup')?.getAttribute('aria-labelledby')).toBeTruthy();
  });
});

describe('Slider', () => {
  afterEach(cleanup);

  function Size({ onChange, onChangeEnd }: { onChange: (v: number) => void; onChangeEnd: (v: number) => void }): JSX.Element {
    const [value, setValue] = useState(1.8);
    return (
      <Slider
        label="Interligne"
        min={1.2}
        max={2.6}
        step={0.1}
        value={value}
        onChange={(v) => {
          onChange(v);
          setValue(v);
        }}
        onChangeEnd={onChangeEnd}
      />
    );
  }

  it('steps precisely with the −/+ buttons and reports the end of the change', async () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    await render(<Size onChange={onChange} onChangeEnd={onChangeEnd} />);
    const plus = buttonByName(format(common.slider.increase, { label: 'Interligne' }));
    const minus = buttonByName(format(common.slider.decrease, { label: 'Interligne' }));

    await click(plus);
    expect(onChange).toHaveBeenLastCalledWith(1.9);
    expect(onChangeEnd).toHaveBeenLastCalledWith(1.9);
    await click(minus);
    await click(minus);
    expect(onChange).toHaveBeenLastCalledWith(1.7);

    const input = document.querySelector('input[type="range"]') as HTMLInputElement;
    expect(input.getAttribute('aria-valuetext')).toBe('1,7');
    expect(document.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Interligne');
  });

  it('jumps to a tapped position on the track', async () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    await render(<Size onChange={onChange} onChangeEnd={onChangeEnd} />);
    const track = document.querySelector('.ui-slider__track') as HTMLElement;
    track.getBoundingClientRect = () => ({ left: 0, width: 434, top: 0, height: 56, right: 434, bottom: 56, x: 0, y: 0, toJSON: () => ({}) });
    const hit = document.querySelector('.ui-slider__hit');
    // thumb 34px: usable width 400px, x = 17 + 400 → max
    await pointer(hit, 'pointerdown', { clientX: 417, clientY: 20 });
    await pointer(hit, 'pointerup', { clientX: 418, clientY: 21 });
    expect(onChange).toHaveBeenLastCalledWith(2.6);
    expect(onChangeEnd).toHaveBeenLastCalledWith(2.6);
  });

  it('ignores a vertical pan starting on the track (page scroll)', async () => {
    const onChange = vi.fn();
    await render(<Size onChange={onChange} onChangeEnd={() => {}} />);
    const hit = document.querySelector('.ui-slider__hit');
    await pointer(hit, 'pointerdown', { clientX: 100, clientY: 10 });
    await pointer(hit, 'pointermove', { clientX: 104, clientY: 60 });
    await pointer(hit, 'pointerup', { clientX: 104, clientY: 90 });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('range math', () => {
  it('snaps to the step grid without floating point noise', () => {
    expect(snapToStep(0.1 + 0.2, 0, 1, 0.1)).toBe(0.3);
    expect(snapToStep(1.84, 1.2, 2.6, 0.1)).toBe(1.8);
    expect(snapToStep(99, 16, 44, 1)).toBe(44);
    expect(snapToStep(-3, 0, 0.3, 0.01)).toBe(0);
    expect(snapToStep(0.047, 0, 0.3, 0.01)).toBe(0.05);
    expect(snapToStep(Number.NaN, 5, 10, 1)).toBe(5);
    expect(snapToStep(7.3, 5, 10, 0)).toBe(7.3);
  });

  it('maps pointer positions and fractions', () => {
    expect(valueFromPointer(17, 0, 434, 16, 44, 1, 34)).toBe(16);
    expect(valueFromPointer(217, 0, 434, 16, 44, 1, 34)).toBe(30);
    expect(valueFromPointer(-50, 0, 434, 16, 44, 1, 34)).toBe(16);
    expect(valueFromPointer(900, 0, 434, 16, 44, 1, 34)).toBe(44);
    expect(rangeFraction(30, 16, 44)).toBe(0.5);
    expect(rangeFraction(5, 5, 5)).toBe(0);
  });
});

describe('ProgressBar', () => {
  afterEach(cleanup);

  it('exposes an accessible progressbar with a French percentage', async () => {
    await render(<ProgressBar label="Chapitre" value={13} max={25} />);
    const bar = byRole('progressbar') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('52');
    expect(bar.getAttribute('aria-valuetext')).toBe('52 %');
    expect(document.getElementById(bar.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Chapitre');
  });

  it('supports an indeterminate state and custom value text', async () => {
    const view = await render(<ProgressBar label="Préparation" value={null} />);
    expect(byRole('progressbar')?.hasAttribute('aria-valuenow')).toBe(false);
    await view.rerender(<ProgressBar label="Préparation" value={3} max={10} valueText="Page 3 sur 10" />);
    expect(byRole('progressbar')?.getAttribute('aria-valuetext')).toBe('Page 3 sur 10');
  });

  it('clamps percentages', () => {
    expect(progressPercent(150)).toBe(100);
    expect(progressPercent(-2)).toBe(0);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(4, 0)).toBe(0);
  });
});

describe('Field', () => {
  afterEach(cleanup);

  it('links label, hint and error to the control', async () => {
    const view = await render(
      <Field label="Prénom" hint="Ou un surnom." error="Écris au moins une lettre.">
        <TextInput value="" onChange={() => {}} />
      </Field>,
    );
    const input = view.container.querySelector('input') as HTMLInputElement;
    expect(view.container.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Prénom');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(['Ou un surnom.', 'Écris au moins une lettre.']);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('renders select options and optional marker', async () => {
    const view = await render(
      <Field label="Niveau" optional size="parent">
        <Select value="avance" onChange={() => {}} options={[{ value: 'debutant', label: 'Débutant' }, { value: 'avance', label: 'Avancé' }]} />
      </Field>,
    );
    const select = view.container.querySelector('select') as HTMLSelectElement;
    expect(select.options).toHaveLength(2);
    expect(select.className).toContain('ui-input--parent');
    expect(select.hasAttribute('aria-invalid')).toBe(false);
    expect(view.container.querySelector('label')?.textContent).toBe(`Niveau (${common.optional})`);
  });
});
