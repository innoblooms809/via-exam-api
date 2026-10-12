/**
 * Business ids ("VIINS7K3Q9X2MD", "VIUSR…") for new rows.
 *
 * Format: "VI" + a 3-letter entity code + 10 characters of Crockford base32
 * (no I, L, O, U, so ids read back over the phone without confusion).
 * 32^10 ≈ 10^15 values drawn from crypto.randomInt, so ids can be minted in
 * a loop — bulk imports included — without the collisions the old
 * "IB" + timestamp + 4-digit helper produced. Every id column is still
 * UNIQUE in the database as the last line of defence.
 *
 * Rows created before this change keep their "IB…" ids; nothing parses the
 * prefix, so both shapes work side by side.
 */

import { randomInt } from "crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RANDOM_LENGTH = 10;

export const ID_KINDS = {
  institute: "INS",
  user: "USR",
  exam: "EXM",
  class: "CLS",
  section: "SEC",
  subject: "SUB",
  session: "SES",
  questionPaper: "QPP",
  answerKey: "ANS",
  answerSheet: "SHT",
  evaluation: "EVL",
  assignment: "ASN",
  scannerAssignment: "SCA",
  attendance: "ATT",
  result: "RES",
  recheck: "RCK",
  notification: "NTF",
  event: "EVT",
} as const;

export type IdKind = keyof typeof ID_KINDS;

const randomPart = (length = RANDOM_LENGTH): string => {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
};

/** A new "VI…" id for the given entity. */
export const newId = (kind: IdKind): string => `VI${ID_KINDS[kind]}${randomPart()}`;
