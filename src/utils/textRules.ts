// What counts as a valid name. A person's name doesn't depend on the language the app is
// shown in, so every language gets the same check and only the messages are translated.
// The UI checks with the same rules (shared/lib/textRules.ts).

/** A letter in any script, then letters (with their accents and vowel marks), spaces, . ' ’ and -. */
export const NAME_CHARS = /^\p{L}[\p{L}\p{M}.'’ -]*$/u;

/** NAME_CHARS, at most 50 characters: the staff forms. */
export const NAME_RULE = /^\p{L}[\p{L}\p{M}.'’ -]{0,49}$/u;

// ─── Numbers typed in any script ─────────────────────────────────────────────
// A number typed on an Arabic, Persian or Indian keyboard arrives in that script's digits
// (١٠١, ۱۰۱, १०१), and text copied from a right-to-left page can carry invisible direction
// marks. Roll numbers, phone numbers and the like are stored with 0-9 and without the marks,
// so the same number matches however it was typed. The UI uses the same rules.

/** The zero of each set of digits read as 0-9. Unicode keeps every set's 0-9 in order. */
export const DIGIT_ZEROS: readonly number[] = [
  0x0660, // Arabic-Indic ٠
  0x06f0, // Extended Arabic-Indic (Persian, Urdu) ۰
  0x07c0, // NKo
  0x0966, // Devanagari ०
  0x09e6, // Bengali
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Oriya
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
  0x0e50, // Thai
  0x0ed0, // Lao
  0x0f20, // Tibetan
  0x1040, // Myanmar
  0x17e0, // Khmer
  0x1810, // Mongolian
  0xff10, // Fullwidth ０
];

/** Every decimal digit except 0-9. */
const OTHER_DIGIT = /[^\P{Nd}0-9]/gu;

/**
 * Invisible characters that are never part of a number or a code: direction marks (LRM, RLM,
 * ALM), embeddings, overrides and isolates, zero-width spaces and joiners, the word joiner,
 * the soft hyphen and the byte order mark.
 */
export const INVISIBLE_CHARS = /[­؜​-‏‪-‮⁠-⁩﻿]/g;

/** Digits of any script listed in DIGIT_ZEROS as 0-9; other characters are kept. */
export const latinDigits = (value: string): string =>
  value.replace(OTHER_DIGIT, (digit) => {
    const code = digit.codePointAt(0) as number;
    const zero = DIGIT_ZEROS.find((z) => code >= z && code <= z + 9);
    return zero === undefined ? digit : String(code - zero);
  });

/**
 * A number or code as it is stored and compared: compatibility forms folded (NFKC, so ０ is 0),
 * invisible marks dropped, digits as 0-9, spaces trimmed. "١٠١" and "‏101" are both "101".
 */
export const normalizeDigits = (value: unknown): string =>
  latinDigits(String(value ?? "").normalize("NFKC").replace(INVISIBLE_CHARS, "")).trim();

/** A roll number as it is stored and compared (roll numbers may hold letters too: "A-12"). */
export const normalizeRollNo = normalizeDigits;

/** A roll number an answer sheet can be named after: 1 to 32 digits (after normalizeRollNo). */
export const ROLL_DIGITS = /^\d{1,32}$/;

/**
 * Short text a form sends as a key, such as a section or exam type name: one encoding per
 * letter (NFC, as Arabic letters with hamza can arrive composed or not), no direction marks,
 * trimmed. Zero-width joiners stay: Persian and Urdu words need them.
 */
export const normalizeKeyText = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFC")
    .replace(/[؜‎‏‪-‮⁦-⁩﻿]/g, "")
    .trim();
