import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';

const LOCALE = 'fr-FR';

/** « 2 h 5 min », « 45 min », « < 1 min ». */
export function formatDuration(ms: number): string {
  const t = parent.activity.duration;
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  if (totalMinutes === 0) return t.seconds;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? format(t.hours, { h, m }) : format(t.minutes, { m });
}

const decimal = (value: number, digits: number): string =>
  new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(value);

/** « 512 o », « 3,4 Mo », « 1,2 Go ». */
export function formatBytes(bytes: number): string {
  const b = parent.bytes;
  const value = Math.max(0, bytes);
  if (value < 1024) return format(b.b, { value: decimal(value, 0) });
  if (value < 1024 ** 2) return format(b.kb, { value: decimal(value / 1024, 0) });
  if (value < 1024 ** 3) return format(b.mb, { value: decimal(value / 1024 ** 2, 1) });
  return format(b.gb, { value: decimal(value / 1024 ** 3, 1) });
}

/** « 3,20 € ». */
export function formatEuros(value: number): string {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' }).format(Number.isFinite(value) ? value : 0);
}

/** « 16 sept. 2026, 14:32 ». */
export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}

/** « 14:32 ». */
export function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

/** « 14:32 » today, « 18 sept. 2026, 09:00 » another day. */
export function formatTimeOrDateTime(ms: number, now = Date.now()): string {
  return new Date(ms).toDateString() === new Date(now).toDateString() ? formatTime(ms) : formatDateTime(ms);
}

/** « il y a 5 minutes », « il y a 2 heures », « hier ». */
export function formatRelativeTime(ms: number, now = Date.now()): string {
  const seconds = Math.round((ms - now) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  if (abs < 60) return rtf.format(seconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86_400), 'day');
}

export function formatNumber(value: number, digits = 2): string {
  return decimal(value, digits);
}
