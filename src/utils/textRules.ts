// What counts as a valid name. A person's name doesn't depend on the language the app is
// shown in, so every language gets the same check and only the messages are translated.
// The UI checks with the same rules (shared/lib/textRules.ts).

/** A letter in any script, then letters (with their accents and vowel marks), spaces, . ' ’ and -. */
export const NAME_CHARS = /^\p{L}[\p{L}\p{M}.'’ -]*$/u;

/** NAME_CHARS, at most 50 characters: the staff forms. */
export const NAME_RULE = /^\p{L}[\p{L}\p{M}.'’ -]{0,49}$/u;
