/**
 * Sign-in sessions, the standard pattern for a browser app (OWASP Session Management, OAuth 2.0
 * Security Best Current Practice for refresh tokens):
 *
 *   access token   JWT for JWT_ACCESS_EXPIRATION_MINUTES (default 15), in an httpOnly cookie sent
 *                  with every API call. Every request also checks the session row, so signing out
 *                  ends the session at once, not when the token runs out.
 *   refresh token  JWT, in an httpOnly cookie the browser sends only to POST /v1/user/refresh-token.
 *                  Valid JWT_REFRESH_EXPIRATION_MINUTES (default 30) after its last use (the idle
 *                  limit), and the session ends AUTH_SESSION_MAX_HOURS (default 8) after sign-in
 *                  however much it is used (the absolute limit; OWASP: 15-30 min idle and 4-8 h in
 *                  all for an app used through a working day). Usable once: every refresh replaces
 *                  it, and the session row keeps only an HMAC digest of the current one.
 *   reuse          a refresh token that was already replaced means someone holds a copy: the
 *                  session ends, for the copy and the real browser alike. Two tabs refreshing at
 *                  the same moment send the same token; one arriving within REUSE_GRACE_MS of the
 *                  change gets a new access token instead.
 *
 * Tokens are signed with keys derived from JWT_SECRET, a different one for each kind so neither can
 * stand in for the other; HS256 only, issuer and audience checked. Neither token is ever put in a
 * response body or anywhere the page's JavaScript can read it.
 */

import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Op, type Transaction } from "sequelize";
import type { CookieOptions, Request, Response } from "express";
import config from "../../config/config";
import logger from "../../config/logger";
import User from "../../models/User.model";
import Role from "../../models/Role.model";
import Institute from "../../models/Institute.model";
import UserSession from "../../models/UserSession.model";
import { digestSecret, verifySecret } from "../../utils/dataProtection";

type TokenKind = "access" | "refresh";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ACCESS_TTL_MS = Number(config.jwt.accessExpirationMinutes) * MINUTE;
// The idle limit is never shorter than an access token's life (a valid token's session must be open).
const REFRESH_TTL_MS = Math.max(ACCESS_TTL_MS, Number(config.jwt.refreshExpirationMinutes) * MINUTE);
const SESSION_MAX_MS = Math.max(REFRESH_TTL_MS, (Number(process.env.AUTH_SESSION_MAX_HOURS) || 8) * HOUR);
if (process.env.JWT_REFRESH_EXPIRATION_DAYS) {
  logger.warn("[Auth] JWT_REFRESH_EXPIRATION_DAYS is no longer read: a session ends after JWT_REFRESH_EXPIRATION_MINUTES (default 30) without use.");
}
const REUSE_GRACE_MS = 30_000;
const ISSUER = "viaexam-api";
const AUDIENCE = "viaexam-app";

// ─── Keys ─────────────────────────────────────────────────────────────────────

const deriveKey = (kind: TokenKind) =>
  crypto.createSecretKey(
    Buffer.from(crypto.hkdfSync("sha256", Buffer.from(String(config.jwt.secret ?? ""), "utf8"), Buffer.alloc(0), `viaexam/jwt/${kind}/v1`, 32))
  );
const KEYS: Record<TokenKind, crypto.KeyObject> = { access: deriveKey("access"), refresh: deriveKey("refresh") };

/** Start-up check: anyone holding one token could try to guess a short secret offline and then sign any token. */
export function assertJwtSecret(): void {
  const length = String(config.jwt.secret ?? "").length;
  if (length >= 32) return;
  const message =
    `JWT_SECRET is ${length} characters long; it signs every sign-in token and needs at least 32 random characters. Create one with\n` +
    `  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"\n` +
    "(everyone signs in again after it changes).";
  if (config.env === "production") throw new Error(message);
  logger.warn(`[Auth] ${message}`);
}

const signToken = (kind: TokenKind, userId: string, sid: string, ttlMs: number) =>
  jwt.sign({ sid, typ: kind }, KEYS[kind], {
    algorithm: "HS256",
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: Math.max(1, Math.floor(ttlMs / 1000)),
    jwtid: crypto.randomBytes(16).toString("base64url"),
  });

export type TokenCheck = { ok: true; userId: string; sid: string } | { ok: false; expired: boolean };

const checkToken = (kind: TokenKind, token: string, ignoreExpiration = false): TokenCheck => {
  try {
    const p = jwt.verify(token, KEYS[kind], { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE, ignoreExpiration }) as jwt.JwtPayload;
    if (p.typ !== kind || typeof p.sub !== "string" || !p.sub || typeof p.sid !== "string" || !p.sid) return { ok: false, expired: false };
    return { ok: true, userId: p.sub, sid: p.sid };
  } catch (err: any) {
    return { ok: false, expired: err?.name === "TokenExpiredError" };
  }
};

export const checkAccessToken = (token: string) => checkToken("access", token);

// ─── Cookies ──────────────────────────────────────────────────────────────────
// One pair per role, so an admin tab and a teacher tab in the same browser stay signed in side by side.

const COOKIES: Record<string, { access: string; refresh: string }> = {
  superadmin: { access: "superAdminToken", refresh: "superAdminRefreshToken" },
  admin: { access: "adminToken", refresh: "adminRefreshToken" },
  teacher: { access: "teacherToken", refresh: "teacherRefreshToken" },
  student: { access: "studentToken", refresh: "studentRefreshToken" },
  scanner: { access: "scannerToken", refresh: "scannerRefreshToken" },
};
const OTHER_ROLE = { access: "accessToken", refresh: "refreshToken" };
const FALLBACK_ORDER = ["admin", "teacher", "superadmin", "student", "scanner"];
const ALL_NAMES = new Set([...Object.values(COOKIES), OTHER_ROLE].flatMap((c) => [c.access, c.refresh]));

const roleKey = (role?: string | null) => String(role ?? "").toLowerCase().replace(/[\s_-]+/g, "");

export const cookieNamesFor = (role?: string | null) => COOKIES[roleKey(role)] ?? OTHER_ROLE;

/** Where to look for a request's token: its page's role (X-User-Role), else every role in a fixed order. */
export const cookieNamesToTry = (kind: TokenKind, role?: string | null): string[] => {
  const own = COOKIES[roleKey(role)];
  return [...(own ? [own] : FALLBACK_ORDER.map((r) => COOKIES[r])).map((c) => c[kind]), OTHER_ROLE[kind]];
};

// HTTPS-only in production. COOKIE_SECURE=false is for a production server reached over plain HTTP.
const SECURE = (() => {
  const raw = String(process.env.COOKIE_SECURE ?? "").trim().toLowerCase();
  return raw ? !/^(0|false|no|off)$/.test(raw) : config.env === "production";
})();

/** The refresh token's cookie goes only to the refresh endpoint (the path the browser sees). */
export const REFRESH_COOKIE_PATH = String(process.env.AUTH_REFRESH_COOKIE_PATH || "/v1/user/refresh-token").trim();

const accessCookie = (): CookieOptions => ({ httpOnly: true, secure: SECURE, sameSite: "lax", path: "/", maxAge: ACCESS_TTL_MS });
const refreshCookie = (): CookieOptions => ({ httpOnly: true, secure: SECURE, sameSite: "strict", path: REFRESH_COOKIE_PATH, maxAge: REFRESH_TTL_MS });

/** Every value of a cookie: a browser can hold two of one name under different paths (older versions used "/"). */
export function cookieValues(req: Request, name: string): string[] {
  const values: string[] = [];
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // not encoded: used as it is
    }
    if (value) values.push(value);
  }
  return values;
}

/** Does the request carry any sign-in cookie? (middlewares/csrf) */
export const hasAuthCookie = (req: Request) =>
  String(req.headers.cookie ?? "")
    .split(";")
    .some((part) => ALL_NAMES.has(part.split("=")[0].trim()));

export function setAuthCookies(res: Response, role: string | null | undefined, tokens: { access: string; refresh?: string }): void {
  const names = cookieNamesFor(role);
  res.cookie(names.access, tokens.access, accessCookie());
  if (!tokens.refresh) return;
  res.cookie(names.refresh, tokens.refresh, refreshCookie());
  // Earlier versions kept the refresh cookie on every path: that copy goes.
  if (REFRESH_COOKIE_PATH !== "/") res.clearCookie(names.refresh, { httpOnly: true, secure: SECURE, sameSite: "lax", path: "/" });
}

export function clearAuthCookies(res: Response, role: string | null | undefined): void {
  const names = cookieNamesFor(role);
  res.clearCookie(names.access, { httpOnly: true, secure: SECURE, sameSite: "lax", path: "/" });
  res.clearCookie(names.refresh, { httpOnly: true, secure: SECURE, sameSite: "strict", path: REFRESH_COOKIE_PATH });
  // The refresh cookie of earlier versions, on every path.
  if (REFRESH_COOKIE_PATH !== "/") res.clearCookie(names.refresh, { httpOnly: true, secure: SECURE, sameSite: "lax", path: "/" });
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

/** Why this account can't use the app now (deleted, inactive, suspended, its institute stopped); null if it can. */
export function accountProblem(user: any): { statusCode: number; message: string } | null {
  if (!user || user.isDeleted) return { statusCode: 401, message: "User not found." };
  // The institute first: suspending it marks all its users 2, and they (the admin included) must
  // hear that the institute is suspended, not "contact your administrator".
  const isSuperAdmin = roleKey(user.role?.role) === "superadmin";
  const institute = user.institute;
  if (!isSuperAdmin && user.instituteId && (!institute || institute.isDeleted || Number(institute.status) !== 1)) {
    return { statusCode: 403, message: "Your institute's ViaExam access is suspended. Contact the ViaExam team." };
  }
  if (Number(user.status) !== 1) {
    return {
      statusCode: 401,
      message: Number(user.status) === 2 ? "Your account is suspended. Contact your administrator." : "Your account is inactive. Contact your administrator.",
    };
  }
  return null;
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

const clientOf = (req: Request) => ({
  ipAddress: String(req.ip || req.socket?.remoteAddress || "").slice(0, 64) || null,
  userAgent: String(req.headers["user-agent"] ?? "").slice(0, 500) || null,
});

export interface SessionTokens {
  sid: string;
  access: string;
  refresh: string;
}

/** A new session for a user who just proved who they are. */
export async function startSession(userId: string, req: Request): Promise<SessionTokens> {
  const sid = crypto.randomBytes(18).toString("base64url");
  const refresh = signToken("refresh", userId, sid, REFRESH_TTL_MS);
  const now = Date.now();
  await UserSession.create({
    id: sid,
    userId,
    tokenHash: digestSecret(refresh, "refresh-token"),
    expiresAt: new Date(now + REFRESH_TTL_MS),
    lastUsedAt: new Date(now),
    ...clientOf(req),
  });
  return { sid, refresh, access: signToken("access", userId, sid, ACCESS_TTL_MS) };
}

/** Is this session still signed in? Asked on every authenticated request. */
export async function sessionIsActive(sid: string, userId: string): Promise<boolean> {
  const row = await UserSession.findOne({ where: { id: sid, userId }, attributes: ["revokedAt", "expiresAt", "createdAt"] });
  const now = Date.now();
  return !!row && !row.revokedAt && row.expiresAt.getTime() > now && row.createdAt.getTime() > now - SESSION_MAX_MS;
}

export async function endSession(sid: string, reason: string): Promise<void> {
  await UserSession.update({ revokedAt: new Date(), revokedReason: reason }, { where: { id: sid, revokedAt: null } });
}

/** Signs the user out everywhere (a new password, a deactivated account), except the session `keepSid` when given. */
export async function endAllSessions(userId: string, reason: string, keepSid?: string | null, transaction?: Transaction): Promise<number> {
  const where: any = { userId, revokedAt: null };
  if (keepSid) where.id = { [Op.ne]: keepSid };
  const [count] = await UserSession.update({ revokedAt: new Date(), revokedReason: reason }, { where, transaction });
  return count;
}

/** Signs out every user of an institute (suspended or deleted). */
export async function endInstituteSessions(instituteId: string, reason: string, transaction?: Transaction): Promise<number> {
  const users = await User.findAll({ where: { instituteId }, attributes: ["userId"], transaction });
  if (!users.length) return 0;
  const [count] = await UserSession.update(
    { revokedAt: new Date(), revokedReason: reason },
    { where: { userId: { [Op.in]: users.map((u) => u.userId) }, revokedAt: null }, transaction }
  );
  return count;
}

/** At sign-in: the session whose cookies this browser held for the role ends, as they are about to be replaced. */
export async function endReplacedSession(req: Request, role: string | null | undefined): Promise<void> {
  for (const token of cookieValues(req, cookieNamesFor(role).access)) {
    const check = checkToken("access", token, true);
    if (check.ok) await endSession(check.sid, "replaced");
  }
}

export type RefreshResult =
  | { ok: true; user: any; access: string; refresh?: string }
  | { ok: false; reason: "missing" | "invalid" | "ended" | "reused" | "account"; problem?: { statusCode: number; message: string }; userId?: string };

/** POST /refresh-token: a new access token (and refresh token) for the session in the request's refresh cookie. */
export async function refreshSession(req: Request, role: string | null | undefined): Promise<RefreshResult> {
  let token = "";
  let found: { userId: string; sid: string } | null = null;
  let any = false;
  for (const name of cookieNamesToTry("refresh", role)) {
    for (const value of cookieValues(req, name)) {
      any = true;
      const check = checkToken("refresh", value);
      if (check.ok) {
        token = value;
        found = check;
        break;
      }
    }
    if (found) break;
  }
  if (!found) return { ok: false, reason: any ? "invalid" : "missing" };

  const { userId, sid } = found;
  const session = await UserSession.findOne({ where: { id: sid, userId } });
  if (!session || session.revokedAt) return { ok: false, reason: "ended", userId };
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || session.createdAt.getTime() <= now - SESSION_MAX_MS) {
    await endSession(sid, "expired");
    return { ok: false, reason: "ended", userId };
  }

  const user: any = await User.findOne({
    where: { userId },
    include: [
      { model: Role, as: "role" },
      { model: Institute, as: "institute" },
    ],
  });
  const problem = accountProblem(user);
  if (problem) {
    await endSession(sid, "inactive");
    return { ok: false, reason: "account", problem, userId };
  }

  if (verifySecret(token, session.tokenHash, "refresh-token")) {
    const refresh = signToken("refresh", userId, sid, REFRESH_TTL_MS);
    const [changed] = await UserSession.update(
      {
        tokenHash: digestSecret(refresh, "refresh-token"),
        previousHash: session.tokenHash,
        rotatedAt: new Date(now),
        lastUsedAt: new Date(now),
        expiresAt: new Date(now + REFRESH_TTL_MS),
        ...clientOf(req),
      },
      { where: { id: sid, tokenHash: session.tokenHash, revokedAt: null } }
    );
    if (changed) return { ok: true, user, refresh, access: signToken("access", userId, sid, ACCESS_TTL_MS) };
    // Another request replaced it a moment ago: judged on the row as it is now.
    await session.reload();
    if (session.revokedAt) return { ok: false, reason: "ended", userId };
  }

  // The token another tab has just replaced: a new access token; the refresh cookie that tab got stays.
  const sinceRotation = session.rotatedAt ? now - session.rotatedAt.getTime() : Infinity;
  if (session.previousHash && sinceRotation <= REUSE_GRACE_MS && verifySecret(token, session.previousHash, "refresh-token")) {
    return { ok: true, user, access: signToken("access", userId, sid, ACCESS_TTL_MS) };
  }

  await endSession(sid, "reuse");
  logger.warn(`[Auth] A replaced refresh token of user ${userId} was used again (session ${sid}); the session was ended.`);
  return { ok: false, reason: "reused", userId };
}
