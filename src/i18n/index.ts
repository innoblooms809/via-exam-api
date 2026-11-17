import fs from 'fs';
import path from 'path';
import i18next from 'i18next';
import { LanguageDetector } from 'i18next-http-middleware';

/**
 * Translations for API messages: locales/<language>/<part>.json at the project root, one file per part of
 * the API (auth.json, institute.json…). English is the language of the code and the default, so it has no
 * files: the English message in the code is the key and is what English answers. A message a language
 * hasn't translated yet is answered in English. `npm run i18n` files new messages and translates them.
 *
 * The languages are the ones in locales/languages.json: to add one, list it there and run the script.
 */
const LOCALES_DIR = [
  path.resolve(__dirname, '../../locales'), // src/i18n (ts-node)
  path.resolve(__dirname, '../../../locales'), // build/src/i18n
].find((dir) => fs.existsSync(path.join(dir, 'languages.json')));
if (!LOCALES_DIR) throw new Error('locales/languages.json not found');

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

export interface LanguageInfo {
  name: string;
  /** Writing direction: "rtl" for Arabic. */
  dir?: 'ltr' | 'rtl';
  /** How units are written (Intl unitDisplay): Arabic's short forms (م.ب) are hard to read, so "long". */
  unitDisplay?: 'short' | 'long' | 'narrow';
}

/** locales/languages.json: each language the API answers in. */
export const LANGUAGE_INFO: Record<string, LanguageInfo> = readJson(path.join(LOCALES_DIR, 'languages.json'));
const languages = Object.keys(LANGUAGE_INFO);

/** All of a language's files merged: `npm run i18n` files every message in exactly one of them. */
const translationsOf = (lng: string): Record<string, string> => {
  const dir = path.join(LOCALES_DIR, lng);
  // English, the code's own language, has no folder.
  if (!fs.existsSync(dir)) return {};
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
  return Object.assign({}, ...files.map((file) => readJson(path.join(dir, file))));
};

i18next.use(LanguageDetector).init({
  resources: Object.fromEntries(languages.map((lng) => [lng, { translation: translationsOf(lng) }])),
  supportedLngs: languages,
  nonExplicitSupportedLngs: true, // "ar-SA" is answered in Arabic
  fallbackLng: 'en',
  preload: languages,
  keySeparator: false,
  nsSeparator: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false }, // JSON, not HTML
  initImmediate: false,
  // The UI sends the language of the page as Accept-Language on every request.
  detection: { order: ['header'], caches: false },
});

export default i18next;
