import { afterEach, describe, expect, it, vi } from 'vitest';
import { PinPad } from '../../src/design/components';
import { appendDigit, canSubmitPin, pinSlotCount, removeLastDigit, resolvePinRules } from '../../src/design/components/internal/pin';
import { common } from '../../src/i18n/fr/common';
import { buttonByName, cleanup, click, keyDown, render } from './render';

async function typeDigits(digits: string): Promise<void> {
  for (const digit of digits) await click(buttonByName(digit));
}

function filledDots(): number {
  return document.querySelectorAll('.ui-pin__dot[data-filled]').length;
}

describe('PinPad', () => {
  afterEach(cleanup);

  it('emits the typed code on submit, masks it and clears the entry', async () => {
    const onSubmit = vi.fn();
    const { container } = await render(<PinPad label="Code des réglages" onSubmit={onSubmit} />);
    const submit = buttonByName(common.pin.submit);

    await typeDigits('123');
    expect(filledDots()).toBe(3);
    expect(submit?.disabled).toBe(true); // below the 4-digit minimum

    await typeDigits('4');
    // The digits are never rendered outside the keys themselves.
    const statusText = container.querySelector('.ui-pin__status')?.textContent ?? '';
    expect(statusText).not.toMatch(/\d{2,}/);
    expect(submit?.disabled).toBe(false);

    await click(submit);
    expect(onSubmit).toHaveBeenCalledWith('1234');
    expect(filledDots()).toBe(0);
  });

  it('erases the last digit and caps the entry at maxLength', async () => {
    const onSubmit = vi.fn();
    await render(<PinPad label="Code" onSubmit={onSubmit} maxLength={5} />);
    await typeDigits('987654');
    expect(filledDots()).toBe(5);
    expect(buttonByName('1')?.disabled).toBe(true);

    await click(buttonByName(common.pin.backspace));
    expect(filledDots()).toBe(4);
    await click(buttonByName(common.pin.submit));
    expect(onSubmit).toHaveBeenCalledWith('9876');
  });

  it('auto-submits when an exact length is reached', async () => {
    const onSubmit = vi.fn();
    await render(<PinPad label="Code" onSubmit={onSubmit} length={6} />);
    expect(document.querySelectorAll('.ui-pin__dot')).toHaveLength(6);
    await typeDigits('20260');
    expect(onSubmit).not.toHaveBeenCalled();
    await typeDigits('9');
    expect(onSubmit).toHaveBeenCalledWith('202609');
  });

  it('accepts a hardware keyboard', async () => {
    const onSubmit = vi.fn();
    await render(<PinPad label="Code" onSubmit={onSubmit} />);
    for (const key of ['5', '8', '1', '3', '7']) await keyDown(document.body, key);
    await keyDown(document.body, 'Backspace');
    await keyDown(document.body, 'Enter');
    expect(onSubmit).toHaveBeenCalledWith('5813');
  });

  it('ignores keys typed in a text field', async () => {
    const onSubmit = vi.fn();
    const { container } = await render(
      <div>
        <input aria-label="autre" />
        <PinPad label="Code" onSubmit={onSubmit} />
      </div>,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    await keyDown(input, '4');
    expect(filledDots()).toBe(0);
  });

  it('shows the error while empty, hides it when typing, and locks keys while busy', async () => {
    const onSubmit = vi.fn();
    const view = await render(<PinPad label="Code" onSubmit={onSubmit} error="Code incorrect" />);
    const error = (): string => document.querySelector('.ui-pin__error')?.textContent ?? '';
    expect(error()).toBe('Code incorrect');
    await typeDigits('1');
    expect(error()).toBe('');

    await view.rerender(<PinPad label="Code" onSubmit={onSubmit} busy />);
    expect(buttonByName('2')?.disabled).toBe(true);
    await keyDown(document.body, '2');
    await click(buttonByName(common.pin.backspace));
    expect(document.querySelector('[role="group"]')?.getAttribute('aria-busy')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('pin rules', () => {
  it('normalises lengths', () => {
    expect(resolvePinRules({ minLength: 4, maxLength: 8 })).toEqual({ min: 4, max: 8, exact: false });
    expect(resolvePinRules({ length: 6, minLength: 4, maxLength: 8 })).toEqual({ min: 6, max: 6, exact: true });
    expect(resolvePinRules({ minLength: 9, maxLength: 4 })).toEqual({ min: 9, max: 9, exact: false });
    expect(resolvePinRules({ minLength: 0, maxLength: 2 })).toEqual({ min: 1, max: 2, exact: false });
  });

  it('edits and validates the entry', () => {
    expect(appendDigit('12', '3', 4)).toBe('123');
    expect(appendDigit('1234', '5', 4)).toBe('1234');
    expect(appendDigit('12', 'a', 4)).toBe('12');
    expect(appendDigit('12', '34', 4)).toBe('12');
    expect(removeLastDigit('123')).toBe('12');
    expect(removeLastDigit('')).toBe('');
    expect(canSubmitPin('123', 4, 8)).toBe(false);
    expect(canSubmitPin('1234', 4, 8)).toBe(true);
    expect(canSubmitPin('123456789', 4, 8)).toBe(false);
    expect(canSubmitPin('12a4', 4, 8)).toBe(false);
    expect(pinSlotCount(0, 4, 8)).toBe(4);
    expect(pinSlotCount(6, 4, 8)).toBe(6);
    expect(pinSlotCount(12, 4, 8)).toBe(8);
  });
});
