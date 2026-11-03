/**
 * Partner webhooks: when an evaluation succeeds or fails, its partner is told at their URL.
 *
 *   POST <webhookUrl>
 *   X-ViaExam-Event:      evaluation.succeeded | evaluation.failed
 *   X-ViaExam-Delivery:   unique id of this delivery (retries keep it)
 *   X-ViaExam-Signature:  t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the key's webhook secret>
 *   body: { "id": "<delivery>", "type": "<event>", "createdAt": "...", "data": <the evaluation> }
 *
 * Deliveries are jobs (partner-webhooks queue): a 2xx answer completes one; a timeout, 429 or
 * 5xx is retried 8 times with backoff (about 2 hours in all); 410 Gone or another 4xx stops.
 * Only public http(s) addresses are called (no localhost / private networks) unless
 * PARTNER_WEBHOOKS_ALLOW_PRIVATE=true (local testing).
 */

import axios from "axios";
import crypto from "crypto";
import dns from "dns";
import http from "http";
import https from "https";
import net from "net";
import logger from "../../config/logger";
import { PartnerApiKey, PartnerEvaluation } from "../../models/PartnerApi.model";
import { defineQueue, PermanentJobError } from "../../queue";
import { positiveInt } from "../../queue/config";
import { unseal } from "../../queue/sealed";
import { toResource } from "./partnerResource";

export type WebhookEvent = "evaluation.succeeded" | "evaluation.failed";

const allowPrivate = () => String(process.env.PARTNER_WEBHOOKS_ALLOW_PRIVATE ?? "").toLowerCase() === "true";

const isPrivateAddress = (ip: string): boolean => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
};

/** Throws unless `url` is http(s) on a public address. */
export async function assertPublicUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("The webhook URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("The webhook URL must use https.");
  if (parsed.username || parsed.password) throw new Error("The webhook URL must not contain credentials.");
  if (allowPrivate()) return;
  if (parsed.protocol !== "https:") throw new Error("The webhook URL must use https.");
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("The webhook URL must point to a public address.");
}

/**
 * DNS lookup for webhook connections that refuses private addresses — checked again at
 * connect time, so a name can't resolve to a public address for the check above and a
 * private one for the request (DNS rebinding).
 */
const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, options as dns.LookupOptions, (err: any, address: any, family?: number) => {
    if (err || allowPrivate()) return (callback as any)(err, address, family);
    const list = Array.isArray(address) ? address.map((a: any) => a.address) : [address];
    if (list.some((a: string) => isPrivateAddress(a))) return (callback as any)(new Error("The webhook URL resolves to a private address."));
    return (callback as any)(null, address, family);
  });
};
const httpAgent = new http.Agent({ lookup: publicLookup });
const httpsAgent = new https.Agent({ lookup: publicLookup });

export const signPayload = (secret: string, timestamp: number, body: string) =>
  crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

interface WebhookJob {
  evaluationId: string;
  event: WebhookEvent;
}

const webhookQueue = defineQueue<WebhookJob>({
  name: "partner-webhooks",
  concurrency: positiveInt(process.env.PARTNER_WEBHOOK_CONCURRENCY, 4),
  defaults: {
    attempts: 8,
    backoff: { type: "exponential", delayMs: positiveInt(process.env.PARTNER_WEBHOOK_RETRY_MS, 30_000) },
    keepCompletedSec: 3 * 24 * 3600,
    keepFailedSec: 14 * 24 * 3600,
  },
  processor: async (job) => {
    const row = await PartnerEvaluation.findOne({ where: { evaluationId: job.data.evaluationId } });
    if (!row?.webhookUrl) return { skipped: "no webhook URL" };
    const key = await PartnerApiKey.findOne({ where: { keyId: row.keyId } });
    if (!key || key.status !== "active") return { skipped: "key revoked" };

    try {
      await assertPublicUrl(row.webhookUrl);
    } catch (err: any) {
      throw new PermanentJobError(err?.message || "The webhook URL is not allowed.");
    }
    const body = JSON.stringify({ id: job.id, type: job.data.event, createdAt: new Date().toISOString(), data: toResource(row) });
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = unseal<string>(key.webhookSecretSealed);
    let status = 0;
    try {
      const res = await axios.post(row.webhookUrl, body, {
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ViaExam-Webhooks/1",
          "X-ViaExam-Event": job.data.event,
          "X-ViaExam-Delivery": job.id,
          "X-ViaExam-Signature": `t=${timestamp},v1=${signPayload(secret, timestamp, body)}`,
        },
        timeout: 10_000,
        maxRedirects: 0,
        httpAgent,
        httpsAgent,
        validateStatus: () => true,
      });
      status = res.status;
    } catch (err: any) {
      throw new Error(`Webhook not delivered: ${err?.code || err?.message || err}`);
    }
    if (status >= 200 && status < 300) return { delivered: status };
    if (status === 408 || status === 429 || status >= 500) throw new Error(`Webhook answered ${status}.`);
    throw new PermanentJobError(`Webhook refused with ${status}; not retried.`);
  },
  onFailed: (job, err) => {
    logger.warn(`[Partner] Webhook ${job.data.event} for ${job.data.evaluationId} gave up: ${err?.message || err}`);
  },
});

/** Queues the webhook of an evaluation's outcome (once per event). */
export function enqueueWebhook(evaluationId: string, event: WebhookEvent): Promise<void> {
  return webhookQueue
    .add("deliver", { evaluationId, event }, { jobId: `wh-${evaluationId}-${event.replace(".", "-")}` })
    .then(() => undefined)
    .catch((err) => {
      logger.warn(`[Partner] Could not queue the ${event} webhook of ${evaluationId}: ${err?.message || err}`);
    });
}
