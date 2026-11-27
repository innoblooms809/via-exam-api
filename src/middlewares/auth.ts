import { NextFunction, Response } from "express";
import httpStatus from "http-status";
import UserModal from "../models/User.model";
import Role from "../models/Role.model";
import Institute from "../models/Institute.model";
import UserPresenceSession from "../models/UserPresenceSession.model";
import logger from "../config/logger";
import { accountProblem, checkAccessToken, cookieNamesFor, cookieNamesToTry, cookieValues, sessionIsActive } from "../services/auth/session.service";

const cleanRole = (r: string): string => {
  return String(r || "").toUpperCase().replace(/[\s_-]+/g, "");
};

const normalizeRoleKey = (r?: string): string => {
  return String(r || "").toLowerCase().replace(/[\s_-]+/g, "");
};

/** Prefer X-User-Role (tab page) over API path, because /teacher and /student are resource routes used by other roles. */
const resolveRequestAuthRole = (req: any): string | undefined => {
  const headerRole = normalizeRoleKey(req.headers["x-user-role"]);
  const allowed = ["superadmin", "admin", "teacher", "student", "scanner"];
  if (allowed.includes(headerRole)) {
    return headerRole;
  }

  const referer = String(req.headers["referer"] || "").toLowerCase();
  const reqPath = String(req.originalUrl || req.url || "").toLowerCase();

  if (referer.includes("/super-admin") || reqPath.includes("/super-admin") || reqPath.includes("/monitoring/platform")) {
    return "superadmin";
  }
  if (referer.includes("/teacher")) return "teacher";
  if (referer.includes("/admin")) return "admin";
  if (referer.includes("/student")) return "student";
  if (referer.includes("/scanner")) return "scanner";
  return undefined;
};

// ─── 1. AUTHENTICATION GUARD ("Who is this? → req.viaExamUser") ───────────────
// The access token comes only from an httpOnly cookie (services/auth/session.service): the page's
// JavaScript never holds it, so a script injected into a page can't take it away.
const unauthorized = (res: Response, message: string) =>
  res.status(httpStatus.UNAUTHORIZED).json({ error: true, statusCode: httpStatus.UNAUTHORIZED, message });

const authenticate = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const reqPath = (req.originalUrl || req.url || "").toLowerCase();
    const authRole = resolveRequestAuthRole(req);
    const isSuperAdminRoute = reqPath.includes("/super-admin") || reqPath.includes("/monitoring/platform");

    // This tab's role cookie only, never another signed-in role's (a super-admin page's own first).
    const names = [...new Set([...(isSuperAdminRoute ? [cookieNamesFor("superadmin").access] : []), ...cookieNamesToTry("access", authRole)])];
    let token: { userId: string; sid: string } | null = null;
    let seen = false;
    let expired = false;
    for (const name of names) {
      for (const value of cookieValues(req, name)) {
        seen = true;
        const check = checkAccessToken(value);
        if (check.ok) {
          token = check;
          break;
        }
        expired ||= check.expired;
      }
      if (token) break;
    }
    if (!seen) return unauthorized(res, "Access token missing.");
    if (!token) return unauthorized(res, expired ? "Token has expired. Please login again." : "Invalid token.");

    // The session must still be signed in (sign-out, a new password, reuse of a stolen refresh
    // token end it at once), and the account and its school still active.
    const [user, active] = await Promise.all([
      UserModal.findOne({
        include: [
          { model: Role, as: "role" },
          { model: Institute, as: "institute" },
        ],
        where: { userId: token.userId },
      }),
      sessionIsActive(token.sid, token.userId),
    ]);
    if (!active) return unauthorized(res, "Your session has ended. Please sign in again.");
    const problem = accountProblem(user);
    if (problem || !user) {
      const { statusCode, message } = problem ?? { statusCode: httpStatus.UNAUTHORIZED, message: "User not found." };
      return res.status(statusCode).json({ error: true, statusCode, message });
    }

    req.viaExamUser = user;
    req.authSessionId = token.sid;

    // ─────────────────────────────────────────────
    // PASSIVE WINSTON ACTIVITY & PRESENCE TRACKER
    // ── Purpose: Automatically logs active user API request to logs/combined.log
    // ── and updates presence status to ONLINE without raw endpoint strings on UI.
    // ─────────────────────────────────────────────
    try {
      const userRole = (user as any).role?.role || "USER";
      const reqPath = (req.originalUrl || req.url || "").toLowerCase();

      // Skip background utility/polling endpoints so they don't overwrite user's main UI activity
      const isUtility =
        reqPath.includes("/notifications") ||
        reqPath.includes("/heartbeat") ||
        reqPath.includes("/profile") ||
        reqPath.includes("/monitoring") ||
        reqPath.includes("/refresh");

      const actionDesc = `${req.method} ${req.baseUrl || ""}${req.path || ""}`;
      logger.info(
        `[WINSTON_ACTIVITY] User: ${user.userId} (${userRole}) | Action: ${actionDesc} | IP: ${req.ip || req.headers["x-forwarded-for"] || "Internal"}`
      );

      if (!isUtility) {
        let humanActivity = "Active in Portal";
        if (reqPath.includes("/class")) humanActivity = "Viewing Classes & Sections";
        else if (reqPath.includes("/subject")) humanActivity = "Managing Subjects";
        else if (reqPath.includes("/exam")) humanActivity = "Creating / Managing Exams";
        else if (reqPath.includes("/student")) humanActivity = "Active in Student Portal";
        else if (reqPath.includes("/teacher") || reqPath.includes("/evaluation")) humanActivity = "Evaluating Answer Sheets";
        else if (reqPath.includes("/scanner") || reqPath.includes("/ocr")) humanActivity = "Scanning Answer Sheets";
        else if (reqPath.includes("/institute")) humanActivity = "Managing School Details";
        else if (reqPath.includes("/user")) humanActivity = "Managing Users";
        else if (reqPath.includes("/auth/login")) humanActivity = "Logged In";

        // Async non-blocking presence update
        UserPresenceSession.findOne({ where: { userId: user.userId } })
          .then((session) => {
            const now = new Date();
            if (session) {
              session.presenceStatus = "ONLINE";
              session.lastActivityAt = now;
              session.currentActivity = humanActivity;
              session.save().catch(() => {});
            } else {
              UserPresenceSession.create({
                userId: user.userId,
                role: userRole,
                instituteId: user.instituteId || null,
                presenceStatus: "ONLINE",
                currentActivity: humanActivity,
                lastActivityAt: now,
                lastLoginAt: now,
              }).catch(() => {});
            }
          })
          .catch(() => {});
      }
    } catch (logErr) {
      // Non-blocking log guard
    }

    next();
  } catch (e: any) {
    logger.error(`Authenticate error: ${e.message}`);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Authentication failed.",
    });
  }
};

// ─── 2. RBAC GUARD ("Can this role perform this action?") ────────────────────
const authorize = (allowedRoles: string[]) => {
  return (req: any, res: Response, next: NextFunction): any => {
    const rawRole = req.viaExamUser?.role?.role;

    if (!rawRole) {
      return res.status(httpStatus.FORBIDDEN).json({
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Role not found on user.",
      });
    }

    const cleanUserRole = cleanRole(rawRole);
    const cleanAllowed = allowedRoles.map(cleanRole);

    if (!cleanAllowed.includes(cleanUserRole)) {
      return res.status(httpStatus.FORBIDDEN).json({
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: `Access denied. Allowed roles: ${allowedRoles.join(", ")}`,
      });
    }

    next();
  };
};

// ─── 3. TENANT BOUNDARY GUARD ("Can this user access THIS institute?") ────────
const verifyTenant = (
  req: any,
  res: Response,
  next: NextFunction
): any => {
  const user = req.viaExamUser;
  if (!user) {
    return res.status(httpStatus.UNAUTHORIZED).json({
      error: true,
      statusCode: httpStatus.UNAUTHORIZED,
      message: "Authentication required before tenant check.",
    });
  }

  const rawRole = user.role?.role || "";
  const cleanUserRole = cleanRole(rawRole);

  // SUPERADMIN bypasses institute tenant boundary checks
  if (cleanUserRole === "SUPERADMIN") {
    return next();
  }

  const requestSlug = (req.headers["x-school-slug"] || req.headers["x-tenant-slug"]) as string | undefined;
  const isGlobalRoute = !requestSlug || ["super-admin", "auth", "api"].includes(requestSlug.toLowerCase());

  if (!isGlobalRoute && requestSlug && user.institute?.slug) {
    const userSlug = user.institute.slug;
    if (userSlug.toLowerCase() !== requestSlug.toLowerCase()) {
      return res.status(httpStatus.FORBIDDEN).json({
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: `Tenant mismatch. Your active session is for school '${userSlug}', but the requested route is '${requestSlug}'. Please log in again for '${requestSlug}'.`,
      });
    }
  }

  next();
};

export { authenticate, authorize, verifyTenant, resolveRequestAuthRole, normalizeRoleKey };
