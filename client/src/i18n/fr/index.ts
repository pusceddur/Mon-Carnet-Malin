import { common } from './common';
import { documents } from './documents';
import { errors } from './errors';
import { exercises } from './exercises';
import { help } from './help';
import { home } from './home';
import { homework } from './homework';
import { library } from './library';
import { notes } from './notes';
import { parent } from './parent';
import { pencil } from './pencil';
import { question } from './question';
import { reader } from './reader';
import { tts } from './tts';

/** All French UI strings, one `as const` object per area (each area file is owned by its module). */
export const fr = { common, home, homework, library, reader, tts, pencil, documents, parent, exercises, notes, help, question, errors } as const;

export type Fr = typeof fr;
export type I18nArea = keyof Fr;

export type FormatVars = Readonly<Record<string, string | number>>;

/** Replaces `{name}` placeholders; unknown placeholders are left untouched. */
export function format(str: string, vars: FormatVars = {}): string {
  return str.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/** Alias of `format`. */
export const t = format;
