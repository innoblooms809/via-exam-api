import { randomInt } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { newId } from "./idGenerator";

// Passwords are drawn from crypto.randomInt. The old generator was "RSP" + the
// clock's last six digits + four random digits, so anyone who knew roughly when
// an account was created could guess its first password.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SPECIAL = "@#$!";

const pick = (chars: string) => chars[randomInt(chars.length)];

const shuffle = (chars: string[]) => {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
};

const strongPassword = (length: number): string => {
  const all = UPPER + LOWER + DIGITS + SPECIAL;
  // At least one of each class, the rest from the whole set, then shuffled.
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
  while (chars.length < length) chars.push(pick(all));
  return shuffle(chars).join("");
};

/** Initial password for a new account (emailed to the user). */
const generatePassword = async (): Promise<string> => strongPassword(12);

/** Temporary password for credential resets, e.g. aB3$xK9!mQ2p */
const generateTempPassword = (): string => strongPassword(12);

/** @deprecated use newId(kind) from utils/idGenerator — kept for old callers. */
const generateUserId = async (): Promise<string> => newId("user");

const generateCustomerId = async (name: string) => {
  const uuid = uuidv4().replace(/-/g, "");
  const p1 = name[0].toUpperCase();
  const p2 = name[name.length - 1].toUpperCase();
  return `${p1}${p2}${uuid}`.slice(0, 12).toUpperCase();
};

const generateEnquiryId = async (productName: string, productCategory: string) => {
  const uuid = uuidv4().replace(/-/g, "");
  const p1 = productName.toUpperCase().slice(0, 2);
  const p2 = productCategory.toUpperCase().slice(0, 2);
  return `${p1}-${p2}-${uuid}`.slice(0, 14).toUpperCase();
};

export default { generatePassword, generateUserId, generateCustomerId, generateEnquiryId, generateTempPassword };
