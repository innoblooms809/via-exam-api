/**
 * Partner API request handling: request ids, API-key auth with scopes, per-key rate limits and
 * the partner error format.
 *
 *   Authorization: Bearer vx_live_…   (or X-API-Key: vx_live_…)
 *   X-Request-Id                       echoed back (one is made when the client sends none)
 *   429 + Retry-After / RateLimit-*    beyond the key's requests per minute
 *
 * Errors: { "error": { "code": "...", "message": "...", "details"?: ... }, "requestId": "..." }
 */

import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import httpStatus from "http-status";
import type { PartnerApiKey, PartnerScope } from "../models/PartnerApi.model";
import { authenticateKey } from "../services/partner/partnerKeys.service";

export type PartnerRequest = Request & { partnerKey?: PartnerApiKey; requestId?: string };

export const sendPartnerError = (req: PartnerRequest, res: Response, status: number, code: string, message: string, details?: unknown) =>
  res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}) }, requestId: req.requestId ?? null });

export const partnerRequestId = (req: PartnerRequest, res: Response, next: NextFunction) => {
  const given = String(req.header("x-request-id") ?? "");
  req.requestId = /^[\w.-]{1,64}$/.test(given) ? given : `req_${crypto.randomBytes(8).toString("hex")}`;
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

const presentedKey = (req: Request) => {
  const auth = String(req.header("authorization") ?? "");
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  return String(req.header("x-api-key") ?? "").trim() || null;
};

/** A valid, active key with every scope listed. */
export const requirePartnerKey = (...scopes: PartnerScope[]) => async (req: PartnerRequest, res: Response, next: NextFunction) => {
  try {
    const key = await authenticateKey(presentedKey(req));
    if (!key) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="viaexam-partner"');
      return sendPartnerError(req, res, httpStatus.UNAUTHORIZED, "unauthorized", "A valid API key is required (Authorization: Bearer vx_live_…).");
    }
    const missing = scopes.filter((s) => !key.scopes.includes(s));
    if (missing.length) return sendPartnerError(req, res, httpStatus.FORBIDDEN, "insufficient_scope", `This key lacks the scope(s): ${missing.join(", ")}.`);
    req.partnerKey = key;
    return next();
  } catch (err: any) {
    return sendPartnerError(req, res, httpStatus.SERVICE_UNAVAILABLE, "unavailable", "Authentication is unavailable. Try again shortly.");
  }
};

/**
 * Requests per minute per key (the key's own limit). Counted per API process; behind N API
 * instances a key gets at most N × its limit.
 */
export const partnerRateLimit = rateLimit({
  windowMs: 60_000,
  max: (req: any) => req.partnerKey?.rateLimitPerMinute ?? 60,
  keyGenerator: (req: any) => req.partnerKey?.keyId ?? req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: any, res: Response, _next: NextFunction, options: any) => {
    res.setHeader("Retry-After", String(Math.ceil(options.windowMs / 1000)));
    return sendPartnerError(req, res, httpStatus.TOO_MANY_REQUESTS, "rate_limited", "Too many requests for this key. Slow down and retry after the Retry-After seconds.");
  },
});
