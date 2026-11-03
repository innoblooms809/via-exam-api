/**
 * Partner API keys.
 *
 *   key        "vx_live_<keyId>_<secret>" — the secret is 32 random bytes; only its SHA-256 is
 *              stored, so a leaked database gives no working key. Shown once, at creation.
 *   webhooks   each key has its own signing secret ("whsec_…"), stored sealed, shown once and
 *              on rotation.
 *
 * Checking a key costs one indexed lookup, cached for 30 s (so a revoked key stops working
 * within 30 s on every API process).
 */

import crypto from "crypto";
import { PARTNER_SCOPES, PartnerApiKey, type PartnerScope } from "../../models/PartnerApi.model";
import { seal } from "../../queue/sealed";
import { assertPublicUrl } from "./partnerWebhooks";

const KEY_PATTERN = /^vx_live_([a-z0-9]{16})_([A-Za-z0-9_-]{43})$/;
const CACHE_MS = 30_000;
const cache = new Map<string, { key: PartnerApiKey; at: number }>();

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const randomId = () => crypto.randomBytes(10).toString("hex").slice(0, 16);
const randomSecret = () => crypto.randomBytes(32).toString("base64url");

export const publicKeyView = (k: PartnerApiKey) => ({
  keyId: k.keyId,
  name: k.name,
  scopes: k.scopes,
  status: k.status,
  rateLimitPerMinute: k.rateLimitPerMinute,
  maxQueued: k.maxQueued,
  webhookUrl: k.webhookUrl,
  createdBy: k.createdBy,
  lastUsedAt: k.lastUsedAt,
  revokedAt: k.revokedAt,
  createdAt: k.createdAt,
});

export async function createKey(input: {
  name: string;
  scopes?: PartnerScope[];
  rateLimitPerMinute?: number;
  maxQueued?: number;
  webhookUrl?: string | null;
  createdBy?: string | null;
}) {
  if (input.webhookUrl) await assertPublicUrl(input.webhookUrl);
  const keyId = randomId();
  const secret = randomSecret();
  const webhookSecret = `whsec_${randomSecret()}`;
  const scopes = (input.scopes?.length ? input.scopes : [...PARTNER_SCOPES]).filter((s) => (PARTNER_SCOPES as readonly string[]).includes(s));
  const key = await PartnerApiKey.create({
    keyId,
    name: input.name,
    keyHash: sha256(secret),
    scopes,
    rateLimitPerMinute: input.rateLimitPerMinute ?? 60,
    maxQueued: input.maxQueued ?? 200,
    webhookUrl: input.webhookUrl ?? null,
    webhookSecretSealed: seal(webhookSecret),
    createdBy: input.createdBy ?? null,
  });
  return { apiKey: `vx_live_${keyId}_${secret}`, webhookSecret, key: publicKeyView(key) };
}

export async function listKeys() {
  const keys = await PartnerApiKey.findAll({ order: [["createdAt", "DESC"]] });
  return keys.map(publicKeyView);
}

export async function updateKey(keyId: string, changes: { name?: string; rateLimitPerMinute?: number; maxQueued?: number; webhookUrl?: string | null; scopes?: PartnerScope[] }) {
  const key = await PartnerApiKey.findOne({ where: { keyId } });
  if (!key) return null;
  if (changes.webhookUrl) await assertPublicUrl(changes.webhookUrl);
  await key.update(changes);
  cache.delete(keyId);
  return publicKeyView(key);
}

export async function revokeKey(keyId: string) {
  const key = await PartnerApiKey.findOne({ where: { keyId } });
  if (!key) return null;
  if (key.status !== "revoked") await key.update({ status: "revoked", revokedAt: new Date() });
  cache.delete(keyId);
  return publicKeyView(key);
}

export async function rotateWebhookSecret(keyId: string) {
  const key = await PartnerApiKey.findOne({ where: { keyId } });
  if (!key) return null;
  const webhookSecret = `whsec_${randomSecret()}`;
  await key.update({ webhookSecretSealed: seal(webhookSecret) });
  cache.delete(keyId);
  return { webhookSecret, key: publicKeyView(key) };
}

/** The active key a request presented, or null. */
export async function authenticateKey(raw: string | undefined | null): Promise<PartnerApiKey | null> {
  const m = String(raw ?? "").trim().match(KEY_PATTERN);
  if (!m) return null;
  const [, keyId, secret] = m;
  const hit = cache.get(keyId);
  const key = hit && Date.now() - hit.at < CACHE_MS ? hit.key : await PartnerApiKey.findOne({ where: { keyId } });
  if (!key) return null;
  if (!hit || hit.key !== key) cache.set(keyId, { key, at: Date.now() });
  const given = Buffer.from(sha256(secret), "hex");
  const stored = Buffer.from(key.keyHash, "hex");
  if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) return null;
  if (key.status !== "active") return null;
  // Last use, at most once a minute.
  if (!key.lastUsedAt || Date.now() - new Date(key.lastUsedAt).getTime() > 60_000) {
    key.lastUsedAt = new Date();
    void PartnerApiKey.update({ lastUsedAt: key.lastUsedAt }, { where: { keyId } }).catch(() => undefined);
  }
  return key;
}

export default { createKey, listKeys, updateKey, revokeKey, rotateWebhookSecret, authenticateKey };
