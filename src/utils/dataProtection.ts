/**
 * Protection of sensitive data at rest.
 *
 *   encryptField / decryptField   reversible, for what the app must read back: answer-sheet file
 *                                 links, profile photo paths, Aadhaar numbers. AES-256-GCM with a
 *                                 fresh 96-bit IV per value and the field's purpose as associated
 *                                 data, so a value copied into another column won't open.
 *                                 Stored as "enc:1:<keyId>:<iv>:<tag>:<ciphertext>" (base64url).
 *   digestSecret / verifySecret   one-way, for secrets that are only ever compared: OTP codes and
 *                                 refresh tokens. HMAC-SHA-256 with a server key, so a copy of the
 *                                 database alone can't be used to test guesses offline.
 *                                 Stored as "hmac:1:<keyId>:<mac>".
 *   Passwords are hashed with bcrypt (utils/encryption.ts).
 *
 * Keys come from DATA_ENCRYPTION_KEY (32 random bytes, base64 or hex). Each value names the key
 * that sealed it: after a rotation the old key goes into DATA_ENCRYPTION_PREVIOUS_KEYS, and the
 * "encrypt-sensitive-data" maintenance task moves every value to the new key. Production refuses
 * to start without the key; development and tests fall back to one derived from JWT_SECRET.
 *
 * Rows written before encryption hold plain text. They are read as they are until that task
 * encrypts them.
 */

import crypto from "crypto";
import type { Model } from "sequelize";
import config from "../config/config";
import logger from "../config/logger";

export type FieldPurpose = "sheet.fileUrl" | "sheet.filePublicId" | "profileUrl" | "aadhaar";
export type DigestPurpose = "otp" | "refresh-token";

const ENC_PREFIX = "enc:1:";
const MAC_PREFIX = "hmac:1:";

export const MISSING_KEY_MESSAGE =
  "DATA_ENCRYPTION_KEY is not set. It encrypts sensitive columns (file links, Aadhaar numbers) and keys the OTP and " +
  "refresh-token digests. Create one with\n" +
  "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n" +
  "and put the same value in the .env of every API and worker process that uses this database. Keep a copy somewhere " +
  "safe (a password manager): without it the encrypted data can't be read.";

interface DataKey {
  id: string;
  enc: Buffer;
  mac: Buffer;
}

interface KeyRing {
  current: DataKey;
  byId: Map<string, DataKey>;
  source: "DATA_ENCRYPTION_KEY" | "derived from JWT_SECRET";
  /** The other keys that only decrypt, described for the start-up log. */
  readOnly: string[];
}

let ring: KeyRing | null = null;

const derive = (secret: Buffer, info: string, length = 32) =>
  Buffer.from(crypto.hkdfSync("sha256", secret, Buffer.alloc(0), `viaexam/${info}`, length));

const makeKey = (master: Buffer): DataKey => ({
  id: derive(master, "key-id", 4).toString("hex"),
  enc: derive(master, "field-encryption/v1"),
  mac: derive(master, "secret-digest/v1"),
});

/** 32 bytes as hex (64 characters) or base64 / base64url (43 characters, plus "=" if padded). */
const parseKey = (raw: string, name: string): Buffer => {
  const value = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  throw new Error(`${name} must be 32 random bytes written as base64 (44 characters) or hex (64 characters).`);
};

const keys = (): KeyRing => {
  if (ring) return ring;
  const configured = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!configured && config.env === "production") throw new Error(MISSING_KEY_MESSAGE);

  // Outside production, values sealed while no key was configured stay readable once one is.
  // Production only ever uses the configured keys.
  const derived =
    config.env !== "production" && config.jwt.secret ? makeKey(derive(Buffer.from(String(config.jwt.secret)), "development-key")) : null;
  const current = configured ? makeKey(parseKey(configured, "DATA_ENCRYPTION_KEY")) : derived;
  if (!current) throw new Error(MISSING_KEY_MESSAGE);

  const all: Array<[DataKey, string]> = [[current, ""]];
  String(process.env.DATA_ENCRYPTION_PREVIOUS_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .forEach((k, i) => all.push([makeKey(parseKey(k, `DATA_ENCRYPTION_PREVIOUS_KEYS (key ${i + 1})`)), "previous key"]));
  if (derived) all.push([derived, `development key from JWT_SECRET (only when NODE_ENV isn't production)`]);

  const byId = new Map<string, DataKey>();
  const readOnly: string[] = [];
  for (const [k, label] of all) {
    if (byId.has(k.id)) continue;
    byId.set(k.id, k);
    if (label) readOnly.push(`${k.id}: ${label}`);
  }
  ring = { current, byId, source: configured ? "DATA_ENCRYPTION_KEY" : "derived from JWT_SECRET", readOnly };
  if (!configured) logger.warn(`[DataProtection] DATA_ENCRYPTION_KEY is not set; using a development key derived from JWT_SECRET (key ${current.id}).`);
  return ring;
};

/** Loads the keys now, so a missing or malformed key stops the process at start, not mid-request. */
export const assertDataKeys = (): { keyId: string; source: string; readableKeys: number; readOnly: string[] } => {
  const r = keys();
  return { keyId: r.current.id, source: r.source, readableKeys: r.byId.size, readOnly: r.readOnly };
};

/** One start-up log line: the key that encrypts, and any others kept only to read older values. */
export const describeDataKeys = () => {
  const k = assertDataKeys();
  return `Encrypting with key ${k.keyId} (${k.source}).` + (k.readOnly.length ? ` Older values can also be read with ${k.readOnly.join("; ")}.` : "");
};

export const currentKeyId = () => keys().current.id;
export const isKnownKey = (keyId: string) => keys().byId.has(keyId);

const b64 = (b: Buffer) => b.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

export const isEncrypted = (value: unknown): value is string => typeof value === "string" && value.startsWith(ENC_PREFIX);

/** Id of the key that sealed this value; null for plain text. */
export const keyIdOf = (value: unknown): string | null => (isEncrypted(value) ? value.slice(ENC_PREFIX.length).split(":")[0] || null : null);

/** The plain text of a sealed value, or null when no configured key opens it (or it was altered). */
const open = (value: string, purpose: FieldPurpose): string | null => {
  const [keyId, iv, tag, data] = value.slice(ENC_PREFIX.length).split(":");
  const key = keys().byId.get(keyId);
  if (!key || !iv || !tag || data === undefined) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key.enc, unb64(iv), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(unb64(tag));
    return Buffer.concat([decipher.update(unb64(data)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
};

const seal = (text: string, purpose: FieldPurpose): string => {
  const key = keys().current;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key.enc, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return `${ENC_PREFIX}${key.id}:${b64(iv)}:${b64(cipher.getAuthTag())}:${b64(data)}`;
};

/** Encrypts a value for storage. null, undefined and "" are stored as they are. */
export function encryptField(value: string, purpose: FieldPurpose): string;
export function encryptField(value: string | null | undefined, purpose: FieldPurpose): string | null | undefined;
export function encryptField(value: string | null | undefined, purpose: FieldPurpose): string | null | undefined {
  if (value === null || value === undefined || value === "") return value;
  const text = String(value);
  // Already sealed for this field (e.g. copied from another row): keep it.
  if (isEncrypted(text) && open(text, purpose) !== null) return text;
  return seal(text, purpose);
}

const lastWarned = new Map<string, number>();

/** The stored value as the app uses it: decrypted, or as it is when it was written before encryption. */
export function decryptField(stored: string, purpose: FieldPurpose): string | null;
export function decryptField(stored: string | null | undefined, purpose: FieldPurpose): string | null | undefined;
export function decryptField(stored: string | null | undefined, purpose: FieldPurpose): string | null | undefined {
  if (stored === null || stored === undefined || stored === "") return stored;
  const text = String(stored);
  if (!isEncrypted(text)) return text;
  const plain = open(text, purpose);
  if (plain === null) {
    // One line per field and key every 5 minutes: a wrong key would otherwise flood the log.
    const tag = `${purpose}|${keyIdOf(text)}`;
    if (Date.now() - (lastWarned.get(tag) ?? 0) > 5 * 60_000) {
      lastWarned.set(tag, Date.now());
      logger.error(
        `[DataProtection] A ${purpose} value sealed with key ${keyIdOf(text)} could not be decrypted. ` +
          (isKnownKey(keyIdOf(text) ?? "") ? "It was altered." : "That key is not configured (DATA_ENCRYPTION_KEY / DATA_ENCRYPTION_PREVIOUS_KEYS).")
      );
    }
  }
  return plain;
}

/** For the re-encryption task: the plain text, or null when the value can't be opened (left alone). */
export const openForRotation = (stored: string, purpose: FieldPurpose): string | null =>
  isEncrypted(stored) ? open(stored, purpose) : stored;

/**
 * Model attribute options for an encrypted column: the model reads and writes plain text, the
 * table holds ciphertext. Raw SQL that selects the column gets ciphertext and must call
 * decryptField itself.
 */
export const encryptedColumn = (attribute: string, purpose: FieldPurpose) => ({
  get(this: Model) {
    return decryptField(this.getDataValue(attribute as never) as string | null | undefined, purpose);
  },
  set(this: Model, value: unknown) {
    const text = value === null || value === undefined ? value : String(value);
    this.setDataValue(attribute as never, encryptField(text, purpose) as never);
  },
});

// ─── Digests ──────────────────────────────────────────────────────────────────

const mac = (key: DataKey, purpose: DigestPurpose, secret: string) =>
  crypto.createHmac("sha256", key.mac).update(`${purpose}\0${secret}`, "utf8").digest("base64url");

/** Equal-time comparison of two strings of any length. */
const sameText = (a: string, b: string) =>
  crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());

export const digestSecret = (secret: string, purpose: DigestPurpose): string => {
  const key = keys().current;
  return `${MAC_PREFIX}${key.id}:${mac(key, purpose, String(secret))}`;
};

/**
 * Whether `secret` matches what was stored. A stored value without the digest prefix was written
 * before digests (a plain OTP or refresh token) and is compared as it is, so nobody is signed out
 * or loses a code they were just sent.
 */
export const verifySecret = (secret: string | null | undefined, stored: string | null | undefined, purpose: DigestPurpose): boolean => {
  if (!secret || !stored) return false;
  if (!stored.startsWith(MAC_PREFIX)) return sameText(String(secret), stored);
  const [keyId, expected] = stored.slice(MAC_PREFIX.length).split(":");
  const key = keys().byId.get(keyId);
  if (!key || !expected) return false;
  return sameText(mac(key, purpose, String(secret)), expected);
};

/** Tests only: forget the loaded keys so changed environment variables apply. */
export const resetDataKeysForTests = () => {
  ring = null;
  lastWarned.clear();
};
