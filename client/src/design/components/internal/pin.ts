export interface PinRules {
  /** Exact length (auto-submit when reached). */
  length?: number;
  minLength: number;
  maxLength: number;
}

/** Normalises the rules: exact length wins, min ≤ max, at least 1 digit. */
export function resolvePinRules(rules: PinRules): { min: number; max: number; exact: boolean } {
  if (rules.length !== undefined && Number.isInteger(rules.length) && rules.length > 0) {
    return { min: rules.length, max: rules.length, exact: true };
  }
  const min = Math.max(1, Math.floor(rules.minLength));
  const max = Math.max(min, Math.floor(rules.maxLength));
  return { min, max, exact: false };
}

export function appendDigit(pin: string, digit: string, max: number): string {
  if (!/^\d$/.test(digit) || pin.length >= max) return pin;
  return pin + digit;
}

export function removeLastDigit(pin: string): string {
  return pin.slice(0, -1);
}

export function canSubmitPin(pin: string, min: number, max: number): boolean {
  return /^\d*$/.test(pin) && pin.length >= min && pin.length <= max;
}

/** Number of mask dots: exact length, otherwise grows from the minimum up to the maximum. */
export function pinSlotCount(entered: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, entered));
}
