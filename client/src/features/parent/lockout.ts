import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';

/** Remaining lock time: « 45 s », « 3 min », « 2 h 5 min » (rounded up). */
export function lockRemainingText(ms: number): string {
  const r = parent.gate.remaining;
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return format(r.seconds, { s: seconds });
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return format(r.minutes, { m: minutes });
  return format(r.hours, { h: Math.floor(minutes / 60), m: minutes % 60 });
}
