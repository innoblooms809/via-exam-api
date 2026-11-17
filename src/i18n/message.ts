/**
 * API messages that carry values ("Roll number 101 is not on this exam's roster."), answered
 * in the request's language.
 *
 * Controllers and services keep writing English. A fixed message stays a plain string: the
 * `message` of a response is translated by it (middlewares/i18n.ts), as before. A message with
 * values is msg(text, values), the text being English with {{placeholders}}, such as
 * Roll number {{rollNo}} is not on this exam's roster. with { rollNo }.
 *
 * The text is the key in locales/<language>/*.json (`npm run i18n` finds every msg call), and
 * the values go in after it is translated. Such a message may sit anywhere in a response (its
 * `message`, each result's `reason`, a summary in `data`) and may be a value of another one.
 *
 * A sentence with a count is msgPlural(count, one, other, values): the English text for one
 * and for many, and the request's language picks its own form for the count (Arabic has six:
 * zero, one, two, few, many and other, kept as key_zero … key_other).
 *
 * In a right-to-left language each text value is wrapped in Unicode isolates, so a file name such
 * as "101.pdf" keeps its order inside an Arabic sentence. Numbers are written with 0-9, as the UI
 * shows them in every language.
 *
 * Away from a response (a log line, a queued job) a message reads as its English text.
 */

import type { TFunction } from 'i18next';
import i18next, { LANGUAGE_INFO } from './index';

export type MessageValues = Record<string, unknown>;

export class LocalizedMessage {
  constructor(readonly key: string, readonly values: MessageValues = {}) {}

  /** The English text, for logs and anything that never reaches a response. */
  toString(): string {
    return renderMessage(this, i18next.getFixedT('en'), 'en');
  }

  toJSON(): string {
    return this.toString();
  }
}

/** A size in bytes, written in the request's language: "9.5 MB", "9.5 ميغابايت". */
export class ByteSize {
  constructor(readonly bytes: number) {}

  toString(): string {
    return formatBytes(this.bytes, 'en');
  }

  toJSON(): string {
    return this.toString();
  }
}

/** Items written as a list in the request's language: "JPG, PNG or WEBP", "JPG أو PNG أو WEBP". */
export class ListValue {
  constructor(readonly items: unknown[], readonly type: 'conjunction' | 'disjunction' = 'conjunction') {}

  toString(): string {
    return renderList(this, i18next.getFixedT('en'), 'en');
  }

  toJSON(): string {
    return this.toString();
  }
}

/** Text shown to the user: a fixed English message, or one with values. */
export type Message = string | LocalizedMessage;

/** An English message with {{placeholders}} and the values that fill them. */
export const msg = (key: string, values?: MessageValues): LocalizedMessage => new LocalizedMessage(key, values);

const englishPlural = new Intl.PluralRules('en');

/**
 * A sentence about `count` things, in its singular and plural English forms. They are the English
 * (there is no English file); a form a language's file doesn't have yet is answered in English, in
 * the form the count needs.
 */
export const msgPlural = (count: number, one: string, other: string, values?: MessageValues): LocalizedMessage =>
  new LocalizedMessage(one, {
    ...values,
    count,
    defaultValue_one: one,
    defaultValue_other: other,
    defaultValue: englishPlural.select(count) === 'one' ? one : other,
  });

/** A byte count, as a message value. */
export const bytes = (count: number): ByteSize => new ByteSize(count);

/** A list, as a message value ("or" for alternatives). */
export const listOf = (items: unknown[], type: 'conjunction' | 'disjunction' = 'conjunction'): ListValue =>
  new ListValue(items, type);

// ─── Rendering ────────────────────────────────────────────────────────────────

const FSI = '⁨';
const PDI = '⁩';

const isRtl = (lng: string) => (LANGUAGE_INFO[lng]?.dir ?? i18next.dir(lng)) === 'rtl';

/** The Intl locale for numbers in a language: 0-9 in every language, as the UI shows them. */
const intlLocale = (lng: string) => `${lng || 'en'}-u-nu-latn`;

export const formatBytes = (count: number, lng: string): string => {
  const value = Number.isFinite(count) && count > 0 ? count : 0;
  const unit = value < 1024 ? 'byte' : value < 1024 * 1024 ? 'kilobyte' : 'megabyte';
  const amount = unit === 'byte' ? value : unit === 'kilobyte' ? value / 1024 : value / 1024 / 1024;
  try {
    return new Intl.NumberFormat(intlLocale(lng), {
      style: 'unit',
      unit,
      unitDisplay: LANGUAGE_INFO[lng]?.unitDisplay ?? 'short',
      maximumFractionDigits: unit === 'megabyte' && amount < 10 ? 1 : 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount * 10) / 10} ${unit === 'byte' ? 'B' : unit === 'kilobyte' ? 'KB' : 'MB'}`;
  }
};

const renderValue = (value: unknown, t: TFunction, lng: string): unknown => {
  if (value instanceof LocalizedMessage) return renderMessage(value, t, lng);
  if (value instanceof ByteSize) return formatBytes(value.bytes, lng);
  if (value instanceof ListValue) return renderList(value, t, lng);
  if (typeof value === 'string' && value && isRtl(lng)) return `${FSI}${value}${PDI}`;
  return value;
};

// Intl.ListFormat is in Node, but not in the lib this project compiles against (es2020).
type ListFormatter = new (locale: string, options: { type: 'conjunction' | 'disjunction' }) => { format(items: string[]): string };
const ListFormat = (Intl as unknown as { ListFormat?: ListFormatter }).ListFormat;

const renderList = (list: ListValue, t: TFunction, lng: string): string => {
  const items = list.items.map((item) => String(renderValue(item, t, lng) ?? ''));
  try {
    if (ListFormat) return new ListFormat(intlLocale(lng), { type: list.type }).format(items);
  } catch {
    /* an unknown locale: the plain list below */
  }
  return items.join(', ');
};

/** A message in one language. `t` is that language's (req.t in a request). */
export const renderMessage = (message: LocalizedMessage, t: TFunction, lng: string): string => {
  const values: MessageValues = {};
  for (const [name, value] of Object.entries(message.values)) {
    // The count picks the plural form; the English defaults are text, not values.
    values[name] = name === 'count' || name.startsWith('defaultValue') ? value : renderValue(value, t, lng);
  }
  return String(t(message.key, { ...values, interpolation: { escapeValue: false } }));
};

/** Text for a user in one language: a fixed message is translated by its English text. */
export const renderText = (text: Message, t: TFunction, lng: string): string =>
  text instanceof LocalizedMessage ? renderMessage(text, t, lng) : String(t(text));

// ─── Responses ────────────────────────────────────────────────────────────────

/** How deep into a response messages are looked for: a batch result's reason is at data.results[i].reason. */
const MAX_DEPTH = 6;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * The response with every message, size and list in it written in one language. Objects and
 * arrays are copied only where something changed; model instances, dates and buffers are left
 * as they are.
 */
export const localizeBody = (value: unknown, t: TFunction, lng: string, depth = 0): unknown => {
  if (value instanceof LocalizedMessage) return renderMessage(value, t, lng);
  if (value instanceof ByteSize) return formatBytes(value.bytes, lng);
  if (value instanceof ListValue) return renderList(value, t, lng);
  if (depth >= MAX_DEPTH) return value;

  if (Array.isArray(value)) {
    let copy: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const next = localizeBody(value[i], t, lng, depth + 1);
      if (next !== value[i]) {
        copy ??= value.slice();
        copy[i] = next;
      }
    }
    return copy ?? value;
  }

  if (isPlainObject(value)) {
    let copy: Record<string, unknown> | null = null;
    for (const key of Object.keys(value)) {
      const next = localizeBody(value[key], t, lng, depth + 1);
      if (next !== value[key]) {
        copy ??= { ...value };
        copy[key] = next;
      }
    }
    return copy ?? value;
  }

  return value;
};
