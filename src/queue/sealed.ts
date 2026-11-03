/**
 * Secret job data (a credential email carries a password) is stored sealed: AES-256-GCM with
 * a key derived from QUEUE_SECRET (or JWT_SECRET). The queue tables then hold ciphertext
 * only, and a tampered payload fails to open instead of being sent.
 */

import crypto from "crypto";
import { queueConfig } from "./config";

const VERSION = "v1";
let key: Buffer | null = null;

const keyOf = (): Buffer => {
  if (key) return key;
  if (!queueConfig.secret) throw new Error("QUEUE_SECRET (or JWT_SECRET) must be set to queue secret job data.");
  key = Buffer.from(crypto.hkdfSync("sha256", queueConfig.secret, "viaexam-queue", "sealed-job-data", 32));
  return key;
};

export const seal = (value: unknown): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyOf(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
};

export const unseal = <T>(sealed: string): T => {
  const [version, iv, tag, data] = String(sealed).split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Sealed job data is malformed.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyOf(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const json = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(json) as T;
};
