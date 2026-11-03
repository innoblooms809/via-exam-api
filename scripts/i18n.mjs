// npm run i18n — keeps the translation files in step with the code.
//
// Layout: <locales>/<language>/<part>.json, one file per part of the app (its feature folder, such as
// master-data.json), with the same file names in every language. The English text is the key, so a
// string without a translation shows in English. languages.json lists the languages.
//
// 1. Extract: finds every English string the code translates (t("...") and the extra patterns below),
//    files it under the part of the app that uses it (common.json when several parts do), and adds new
//    ones to the English files.
// 2. Translate: sends the strings a language lacks to Google Translate and saves the answers. Strings
//    already translated are never sent again, so a person's corrections stay.
// 3. Index (front end only): rewrites <locales>/index.ts, which loads every file into the app.
//
// To add a language: add it to languages.json and run this script. Google needs GOOGLE_TRANSLATE_API_KEY
// (in .env or the environment): a Google Cloud API key with the Cloud Translation API enabled. Without
// it the script still files and lists what is missing, and the app shows those strings in English.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── What this project translates ─────────────────────────────────────────────
const LOCALES_DIR = path.join(ROOT, "locales");
const LANGUAGES_FILE = path.join(LOCALES_DIR, "languages.json");
const SOURCE_LANGUAGE = "en";
const SOURCE_DIRS = ["src"];
/** None: the API reads the folders when it starts (src/i18n/index.ts). */
const INDEX_FILE = null;

/** The part of the API a source file belongs to; its messages go in <language>/<part>.json. */
function partOf(file) {
  const [, kind, feature] = file.split("/"); // src/services/institute/institute.service.ts → institute
  if (["controllers", "services", "validations"].includes(kind) && feature && !feature.includes(".")) return feature;
  return "common";
}

/**
 * English text kept in data rather than in t("...") calls, and translated where it is shown. "*" is every file.
 * Here: the `message` of every JSON response and of every ApiError, which middlewares/i18n.ts translates on the way out.
 */
const EXTRA_PATTERNS = {
  "*": [
    /\bmessage:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1(?=\s*[,}\r\n)])/g,
    /\bnew ApiError\(\s*[\w.]+\s*,\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1(?=\s*[,)])/g,
  ],
};
// ─────────────────────────────────────────────────────────────────────────────

const T_CALL = /\bt\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

/** The string a JS literal's body stands for, or null for a template with ${…}. */
function unquote(quote, body) {
  if (quote === "`" && body.includes("${")) return null;
  try {
    const asDouble = quote === '"' ? body : body.replace(/\\(['`])/g, "$1").replace(/(^|[^\\])"/g, '$1\\"');
    return JSON.parse(`"${asDouble}"`);
  } catch {
    return null;
  }
}

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".") && full !== LOCALES_DIR) yield* sourceFiles(full);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      yield full;
    }
  }
}

/** Every string the code translates, with the parts of the app that use it. */
function extract() {
  const parts = new Map();
  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      const code = fs.readFileSync(file, "utf8");
      for (const pattern of [T_CALL, ...(EXTRA_PATTERNS["*"] ?? []), ...(EXTRA_PATTERNS[rel] ?? [])]) {
        for (const m of code.matchAll(pattern)) {
          const text = unquote(m[1], m[2])?.trim();
          if (!text) continue;
          if (!parts.has(text)) parts.set(text, new Set());
          parts.get(text).add(partOf(rel));
        }
      }
    }
  }
  return parts;
}

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
const writeJson = (file, data) => {
  const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n", "utf8");
};

/** A language's translations from its folder, and from the old one-file layout (<language>.json), moved in. */
function loadLanguage(lng) {
  const strings = {};
  const filedIn = {};
  const flat = path.join(LOCALES_DIR, `${lng}.json`);
  Object.assign(strings, readJson(flat));
  const dir = path.join(LOCALES_DIR, lng);
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const part = file.slice(0, -".json".length);
      for (const [key, value] of Object.entries(readJson(path.join(dir, file)))) {
        strings[key] = value;
        filedIn[key] = part;
      }
    }
  }
  return { strings, filedIn, flat };
}

/** Writes one language's strings into <language>/<part>.json, one file per part, and drops old files. */
function saveLanguage(lng, strings, partOfKey, parts, flat) {
  const dir = path.join(LOCALES_DIR, lng);
  fs.mkdirSync(dir, { recursive: true });
  const byPart = Object.fromEntries(parts.map((p) => [p, {}]));
  for (const [key, value] of Object.entries(strings)) byPart[partOfKey(key)][key] = value;
  for (const part of parts) writeJson(path.join(dir, `${part}.json`), byPart[part]);
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith(".json") && !parts.includes(file.slice(0, -".json".length))) fs.rmSync(path.join(dir, file));
  }
  if (fs.existsSync(flat)) fs.rmSync(flat);
}

function writeIndex(languages, parts) {
  const id = (lng, part) => `${lng}_${part}`.replace(/[^A-Za-z0-9_]/g, "_");
  const lines = [
    "// Generated by `npm run i18n` (scripts/i18n.mjs): every translation file, loaded into the app.",
    "// Don't edit it: wrap text in the code in t(), then run the script.",
    "",
  ];
  for (const lng of languages) for (const part of parts) lines.push(`import ${id(lng, part)} from "./${lng}/${part}.json";`);
  lines.push("", "export const resources: Record<string, Record<string, string>> = {");
  for (const lng of languages) lines.push(`  ${lng}: { ${parts.map((part) => `...${id(lng, part)}`).join(", ")} },`);
  lines.push("};", "");
  fs.writeFileSync(INDEX_FILE, lines.join("\n"), "utf8");
}

// Google is sent HTML so {{placeholders}} can be marked "do not translate".
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const protect = (s) => escapeHtml(s).replace(/\{\{\s*([\w.]+)\s*\}\}/g, '<span translate="no">$1</span>');
const restore = (s) =>
  s
    .replace(/\s*<span translate="no">\s*([\w.]+)\s*<\/span>\s*/g, " {{$1}} ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s{2,}/g, " ")
    .trim();

async function googleTranslate(texts, target, apiKey) {
  const out = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: batch.map(protect), source: SOURCE_LANGUAGE, target, format: "html" }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Google Translate ${res.status}: ${body?.error?.message ?? JSON.stringify(body)}`);
    out.push(...body.data.translations.map((t) => restore(t.translatedText)));
    process.stdout.write(`  ${target}: ${Math.min(i + 100, texts.length)}/${texts.length}\r`);
  }
  process.stdout.write("\n");
  return out;
}

async function main() {
  loadEnv();
  fs.mkdirSync(LOCALES_DIR, { recursive: true });
  const listed = Object.keys(readJson(LANGUAGES_FILE));
  const languages = [SOURCE_LANGUAGE, ...listed.filter((lng) => lng !== SOURCE_LANGUAGE)];

  // Where each string is filed: the one part of the app that uses it, else common. A string the code
  // no longer uses stays where it was (delete it by hand once it is gone for good).
  const found = extract();
  const source = loadLanguage(SOURCE_LANGUAGE);
  const partOfKey = (key) => {
    const usedBy = found.get(key);
    if (usedBy) return usedBy.size === 1 ? [...usedBy][0] : "common";
    return source.filedIn[key] ?? "common";
  };

  const en = source.strings;
  const added = [...found.keys()].filter((key) => !(key in en));
  for (const key of added) en[key] = key;
  const parts = [...new Set(Object.keys(en).map(partOfKey))].sort();
  saveLanguage(SOURCE_LANGUAGE, en, partOfKey, parts, source.flat);
  console.log(`${SOURCE_LANGUAGE}: ${Object.keys(en).length} strings (${added.length} new) in ${parts.length} files: ${parts.join(", ")}`);
  const unused = Object.keys(en).filter((key) => !found.has(key));
  if (unused.length) console.log(`  ${unused.length} no longer found in the code (kept)`);

  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  for (const lng of languages.slice(1)) {
    const { strings, flat } = loadLanguage(lng);
    for (const key of Object.keys(strings)) if (!(key in en)) delete strings[key];
    const missing = Object.keys(en).filter((key) => !strings[key]);
    if (missing.length && apiKey) {
      const translated = await googleTranslate(missing.map((key) => en[key]), lng, apiKey);
      missing.forEach((key, i) => (strings[key] = translated[i]));
      console.log(`${lng}: translated ${missing.length} strings — have a speaker of the language check them`);
    } else if (missing.length) {
      console.log(`${lng}: ${missing.length} strings untranslated (set GOOGLE_TRANSLATE_API_KEY to translate them)`);
    } else {
      console.log(`${lng}: complete`);
    }
    saveLanguage(lng, strings, partOfKey, parts, flat);
  }

  if (INDEX_FILE) writeIndex(languages, parts);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
