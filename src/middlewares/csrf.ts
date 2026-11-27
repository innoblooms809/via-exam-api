import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import logger from "../config/logger";
import { hasAuthCookie } from "../services/auth/session.service";

/**
 * Cross-site request forgery guard (OWASP: verify the origin with standard headers). Sign-in lives
 * in cookies, which a browser attaches to any request to this API, including one another website
 * makes it send. So a request that changes something (POST, PUT, PATCH, DELETE) must come from one
 * of the app's own pages: its Origin (or, without one, its Referer) must be an allowed front end
 * (CORS_ORIGIN, FRONTEND_URL) or this API's own host (also as the proxy in front of it names it).
 * SameSite cookies stop most of these already; this is the second lock.
 *
 * A request with neither header and no sign-in cookie passes (servers, scripts): a forged request
 * always comes from a browser, and browsers send Origin. Partner API calls (API key, no cookies)
 * and the Stripe webhook are not checked.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const UNCHECKED = [/^\/v1\/partner\//, /^\/v1\/subscription\/webhook$/];

const originOf = (value: unknown): URL | null => {
  if (typeof value !== "string" || !value || value === "null") return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const ownHosts = (req: Request) =>
  new Set(
    [req.headers.host, ...String(req.headers["x-forwarded-host"] ?? "").split(",")]
      .map((h) => String(h ?? "").trim().toLowerCase())
      .filter(Boolean)
  );

export const csrfGuard =
  (isAllowedOrigin: (origin: string) => boolean) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method) || UNCHECKED.some((path) => path.test(req.path))) return next();

    const origin = req.headers.origin;
    const referer = req.headers.referer;
    if (origin === undefined && !referer) {
      if (!hasAuthCookie(req)) return next();
    } else {
      const source = originOf(origin !== undefined ? origin : referer);
      if (source && (isAllowedOrigin(source.origin) || ownHosts(req).has(source.host.toLowerCase()))) return next();
    }

    logger.warn(`[CSRF] Blocked ${req.method} ${req.originalUrl}: origin ${String(origin ?? referer ?? "missing")}`);
    return res.status(httpStatus.FORBIDDEN).json({
      error: true,
      statusCode: httpStatus.FORBIDDEN,
      message: "This request did not come from the ViaExam app.",
    });
  };
