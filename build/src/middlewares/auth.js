"use strict";
// import jwt from "jsonwebtoken";
// import UserModel from "../modals/User.modal";
// import config from "../config/config";
// import { NextFunction, Request, Response } from "express";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRoleKey = exports.resolveRequestAuthRole = exports.verifyTenant = exports.authorize = exports.authenticate = void 0;
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
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const http_status_1 = __importDefault(require("http-status"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Role_modal_1 = __importDefault(require("../modals/Role.modal"));
const Institute_modal_1 = __importDefault(require("../modals/Institute.modal"));
const UserPresenceSession_modal_1 = __importDefault(require("../modals/UserPresenceSession.modal"));
const config_1 = __importDefault(require("../config/config"));
const logger_1 = __importDefault(require("../config/logger"));
const getCookieValue = (req, name) => {
    var _a, _b;
    if ((_a = req.cookies) === null || _a === void 0 ? void 0 : _a[name]) {
        return req.cookies[name];
    }
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
        return undefined;
    }
    return (_b = cookieHeader
        .split(";")
        .map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith(`${name}=`))) === null || _b === void 0 ? void 0 : _b.split("=").slice(1).join("=");
};
const cleanRole = (r) => {
    return String(r || "").toUpperCase().replace(/[\s_-]+/g, "");
};
const normalizeRoleKey = (r) => {
    return String(r || "").toLowerCase().replace(/[\s_-]+/g, "");
};
exports.normalizeRoleKey = normalizeRoleKey;
/** Prefer X-User-Role (tab page) over API path, because /teacher and /student are resource routes used by other roles. */
const resolveRequestAuthRole = (req) => {
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
    if (referer.includes("/teacher"))
        return "teacher";
    if (referer.includes("/admin"))
        return "admin";
    if (referer.includes("/student"))
        return "student";
    if (referer.includes("/scanner"))
        return "scanner";
    return undefined;
};
exports.resolveRequestAuthRole = resolveRequestAuthRole;
// ─── 1. AUTHENTICATION GUARD ("Who is this? → req.viaExamUser") ───────────────
const authenticate = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
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
        let cookieToken;
        if (authRole === "superadmin")
            cookieToken = superAdminCookie || defaultCookie;
        else if (authRole === "admin")
            cookieToken = adminCookie || defaultCookie;
        else if (authRole === "teacher")
            cookieToken = teacherCookie || defaultCookie;
        else if (authRole === "student")
            cookieToken = studentCookie || defaultCookie;
        else if (authRole === "scanner")
            cookieToken = scannerCookie || defaultCookie;
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
            return res.status(http_status_1.default.UNAUTHORIZED).json({
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: "Access token missing.",
            });
        }
        let token;
        const bearerToken = (authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer ")) ? authHeader.split(" ")[1] : undefined;
        const isValidBearer = !!(bearerToken && bearerToken !== "undefined" && bearerToken !== "null");
        const isUsableJwt = (value) => {
            if (!value)
                return false;
            try {
                jsonwebtoken_1.default.verify(value, config_1.default.jwt.secret);
                return true;
            }
            catch (_a) {
                return false;
            }
        };
        const isSuperAdminRoute = reqPath.includes("/super-admin") || reqPath.includes("/monitoring/platform");
        if (isSuperAdminRoute && isUsableJwt(superAdminCookie)) {
            token = superAdminCookie;
        }
        else if (isUsableJwt(bearerToken)) {
            token = bearerToken;
        }
        else if (isUsableJwt(cookieToken)) {
            token = cookieToken;
        }
        else {
            token = isValidBearer ? bearerToken : cookieToken;
        }
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(token || "", config_1.default.jwt.secret);
        }
        catch (err) {
            return res.status(http_status_1.default.UNAUTHORIZED).json({
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: err.name === "TokenExpiredError"
                    ? "Token has expired. Please login again."
                    : "Invalid token.",
            });
        }
        const userId = typeof decoded.sub === "object"
            ? (_a = decoded.sub) === null || _a === void 0 ? void 0 : _a.userId
            : (_b = decoded.sub) !== null && _b !== void 0 ? _b : decoded.userId;
        if (!userId) {
            return res.status(http_status_1.default.UNAUTHORIZED).json({
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: "Invalid token payload.",
            });
        }
        const user = yield User_modal_1.default.findOne({
            include: [
                { model: Role_modal_1.default, as: "role" },
                { model: Institute_modal_1.default, as: "institute" },
            ],
            where: { userId },
        });
        if (!user) {
            return res.status(http_status_1.default.UNAUTHORIZED).json({
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
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
            const userRole = ((_c = user.role) === null || _c === void 0 ? void 0 : _c.role) || "USER";
            const reqPath = (req.originalUrl || req.url || "").toLowerCase();
            // Skip background utility/polling endpoints so they don't overwrite user's main UI activity
            const isUtility = reqPath.includes("/notifications") ||
                reqPath.includes("/heartbeat") ||
                reqPath.includes("/profile") ||
                reqPath.includes("/monitoring") ||
                reqPath.includes("/refresh");
            const actionDesc = `${req.method} ${req.baseUrl || ""}${req.path || ""}`;
            logger_1.default.info(`[WINSTON_ACTIVITY] User: ${user.userId} (${userRole}) | Action: ${actionDesc} | IP: ${req.ip || req.headers["x-forwarded-for"] || "Internal"}`);
            if (!isUtility) {
                let humanActivity = "Active in Portal";
                if (reqPath.includes("/class"))
                    humanActivity = "Viewing Classes & Sections";
                else if (reqPath.includes("/subject"))
                    humanActivity = "Managing Subjects";
                else if (reqPath.includes("/exam"))
                    humanActivity = "Creating / Managing Exams";
                else if (reqPath.includes("/student"))
                    humanActivity = "Active in Student Portal";
                else if (reqPath.includes("/teacher") || reqPath.includes("/evaluation"))
                    humanActivity = "Evaluating Answer Sheets";
                else if (reqPath.includes("/scanner") || reqPath.includes("/ocr"))
                    humanActivity = "Scanning Answer Sheets";
                else if (reqPath.includes("/institute"))
                    humanActivity = "Managing School Details";
                else if (reqPath.includes("/user"))
                    humanActivity = "Managing Users";
                else if (reqPath.includes("/auth/login"))
                    humanActivity = "Logged In";
                // Async non-blocking presence update
                UserPresenceSession_modal_1.default.findOne({ where: { userId: user.userId } })
                    .then((session) => {
                    const now = new Date();
                    if (session) {
                        session.presenceStatus = "ONLINE";
                        session.lastActivityAt = now;
                        session.currentActivity = humanActivity;
                        session.save().catch(() => { });
                    }
                    else {
                        UserPresenceSession_modal_1.default.create({
                            userId: user.userId,
                            role: userRole,
                            instituteId: user.instituteId || null,
                            presenceStatus: "ONLINE",
                            currentActivity: humanActivity,
                            lastActivityAt: now,
                            lastLoginAt: now,
                        }).catch(() => { });
                    }
                })
                    .catch(() => { });
            }
        }
        catch (logErr) {
            // Non-blocking log guard
        }
        next();
    }
    catch (e) {
        logger_1.default.error(`Authenticate error: ${e.message}`);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Authentication failed.",
        });
    }
});
exports.authenticate = authenticate;
// ─── 2. RBAC GUARD ("Can this role perform this action?") ────────────────────
const authorize = (allowedRoles) => {
    return (req, res, next) => {
        var _a, _b;
        const rawRole = (_b = (_a = req.viaExamUser) === null || _a === void 0 ? void 0 : _a.role) === null || _b === void 0 ? void 0 : _b.role;
        if (!rawRole) {
            return res.status(http_status_1.default.FORBIDDEN).json({
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Role not found on user.",
            });
        }
        const cleanUserRole = cleanRole(rawRole);
        const cleanAllowed = allowedRoles.map(cleanRole);
        if (!cleanAllowed.includes(cleanUserRole)) {
            return res.status(http_status_1.default.FORBIDDEN).json({
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: `Access denied. Allowed roles: ${allowedRoles.join(", ")}`,
            });
        }
        next();
    };
};
exports.authorize = authorize;
// ─── 3. TENANT BOUNDARY GUARD ("Can this user access THIS institute?") ────────
const verifyTenant = (req, res, next) => {
    var _a, _b;
    const user = req.viaExamUser;
    if (!user) {
        return res.status(http_status_1.default.UNAUTHORIZED).json({
            error: true,
            statusCode: http_status_1.default.UNAUTHORIZED,
            message: "Authentication required before tenant check.",
        });
    }
    const rawRole = ((_a = user.role) === null || _a === void 0 ? void 0 : _a.role) || "";
    const cleanUserRole = cleanRole(rawRole);
    // SUPERADMIN bypasses institute tenant boundary checks
    if (cleanUserRole === "SUPERADMIN") {
        return next();
    }
    const requestSlug = (req.headers["x-school-slug"] || req.headers["x-tenant-slug"]);
    const isGlobalRoute = !requestSlug || ["super-admin", "auth", "api"].includes(requestSlug.toLowerCase());
    if (!isGlobalRoute && requestSlug && ((_b = user.institute) === null || _b === void 0 ? void 0 : _b.slug)) {
        const userSlug = user.institute.slug;
        if (userSlug.toLowerCase() !== requestSlug.toLowerCase()) {
            return res.status(http_status_1.default.FORBIDDEN).json({
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: `Tenant mismatch. Your active session is for school '${userSlug}', but the requested route is '${requestSlug}'. Please log in again for '${requestSlug}'.`,
            });
        }
    }
    next();
};
exports.verifyTenant = verifyTenant;
