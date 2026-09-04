// import jwt from "jsonwebtoken";
// import UserModel from "../modals/User.modal";
// import config from "../config/config";
// import { NextFunction, Request, Response } from "express";


// const authenticate = async (req: any, res: Response, next: NextFunction) => {
//   const token = req.headers.authorization?.split(" ")[1];

//   if (!token) {
//     return res.status(401).json({ message: "Authentication required" });
//   }

//   try {
//     const decodedToken: any = jwt.verify(token, config.jwt.secret);
//     const user = await UserModel.findOne({where:{userId:decodedToken?.sub.userId}});
//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }
//     req.user = user;
//     next();
//   } catch (error) {
//     res.status(401).json({ message: "Invalid token" });
//   }
// };

// export default authenticate;

import jwt from "jsonwebtoken";
import { NextFunction, Response } from "express";
import httpStatus from "http-status";
import UserModal from "../modals/User.modal";
import Role from "../modals/Role.modal";
import Institute from "../modals/Institute.modal";
import UserPresenceSession from "../modals/UserPresenceSession.modal";
import config from "../config/config";
import logger from "../config/logger";

const getCookieValue = (req: any, name: string): string | undefined => {
  if (req.cookies?.[name]) {
    return req.cookies[name];
  }

  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }

  return cookieHeader
    .split(";")
    .map((cookie: string) => cookie.trim())
    .find((cookie: string) => cookie.startsWith(`${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
};

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
const authenticate = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const authHeader = req.headers.authorization;

    const superAdminCookie = getCookieValue(req, "superAdminToken");
    const adminCookie = getCookieValue(req, "adminToken");
    const teacherCookie = getCookieValue(req, "teacherToken");
    const studentCookie = getCookieValue(req, "studentToken");
    const scannerCookie = getCookieValue(req, "scannerToken");
    const defaultCookie = getCookieValue(req, "accessToken");

    const reqPath = (req.originalUrl || req.url || "").toLowerCase();
    const authRole = resolveRequestAuthRole(req);

    // Use only this tab's role cookie — never fall back to another logged-in role
    let cookieToken: string | undefined;
    if (authRole === "superadmin") cookieToken = superAdminCookie || defaultCookie;
    else if (authRole === "admin") cookieToken = adminCookie || defaultCookie;
    else if (authRole === "teacher") cookieToken = teacherCookie || defaultCookie;
    else if (authRole === "student") cookieToken = studentCookie || defaultCookie;
    else if (authRole === "scanner") cookieToken = scannerCookie || defaultCookie;
    else {
      cookieToken =
        adminCookie ||
        teacherCookie ||
        superAdminCookie ||
        studentCookie ||
        scannerCookie ||
        defaultCookie;
    }

    if ((!authHeader || !authHeader.startsWith("Bearer ")) && !cookieToken) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message: "Access token missing.",
      });
    }

    let token: string | undefined;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : undefined;
    const isValidBearer = !!(bearerToken && bearerToken !== "undefined" && bearerToken !== "null");

    const isUsableJwt = (value?: string) => {
      if (!value) return false;
      try {
        jwt.verify(value, config.jwt.secret);
        return true;
      } catch {
        return false;
      }
    };

    const isSuperAdminRoute = reqPath.includes("/super-admin") || reqPath.includes("/monitoring/platform");
    if (isSuperAdminRoute && isUsableJwt(superAdminCookie)) {
      token = superAdminCookie;
    } else if (isUsableJwt(bearerToken)) {
      token = bearerToken;
    } else if (isUsableJwt(cookieToken)) {
      token = cookieToken;
    } else {
      token = isValidBearer ? bearerToken : cookieToken;
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token || "", config.jwt.secret);
    } catch (err: any) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message:
          err.name === "TokenExpiredError"
            ? "Token has expired. Please login again."
            : "Invalid token.",
      });
    }

    const userId =
      typeof decoded.sub === "object"
        ? decoded.sub?.userId
        : decoded.sub ?? decoded.userId;

    if (!userId) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message: "Invalid token payload.",
      });
    }

    const user = await UserModal.findOne({
      include: [
        { model: Role, as: "role" },
        { model: Institute, as: "institute" },
      ],
      where: { userId },
    });

    if (!user) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message: "User not found.",
      });
    }

    req.viaExamUser = user;

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
