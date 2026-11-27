"use strict";
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
const http_status_1 = __importDefault(require("http-status"));
const User_model_1 = __importDefault(require("../models/User.model"));
const Role_model_1 = __importDefault(require("../models/Role.model"));
const Institute_model_1 = __importDefault(require("../models/Institute.model"));
const UserPresenceSession_model_1 = __importDefault(require("../models/UserPresenceSession.model"));
const logger_1 = __importDefault(require("../config/logger"));
const session_service_1 = require("../services/auth/session.service");
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
// The access token comes only from an httpOnly cookie (services/auth/session.service): the page's
// JavaScript never holds it, so a script injected into a page can't take it away.
const unauthorized = (res, message) => res.status(http_status_1.default.UNAUTHORIZED).json({ error: true, statusCode: http_status_1.default.UNAUTHORIZED, message });
const authenticate = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const reqPath = (req.originalUrl || req.url || "").toLowerCase();
        const authRole = resolveRequestAuthRole(req);
        const isSuperAdminRoute = reqPath.includes("/super-admin") || reqPath.includes("/monitoring/platform");
        // This tab's role cookie only, never another signed-in role's (a super-admin page's own first).
        const names = [...new Set([...(isSuperAdminRoute ? [(0, session_service_1.cookieNamesFor)("superadmin").access] : []), ...(0, session_service_1.cookieNamesToTry)("access", authRole)])];
        let token = null;
        let seen = false;
        let expired = false;
        for (const name of names) {
            for (const value of (0, session_service_1.cookieValues)(req, name)) {
                seen = true;
                const check = (0, session_service_1.checkAccessToken)(value);
                if (check.ok) {
                    token = check;
                    break;
                }
                expired || (expired = check.expired);
            }
            if (token)
                break;
        }
        if (!seen)
            return unauthorized(res, "Access token missing.");
        if (!token)
            return unauthorized(res, expired ? "Token has expired. Please login again." : "Invalid token.");
        // The session must still be signed in (sign-out, a new password, reuse of a stolen refresh
        // token end it at once), and the account and its school still active.
        const [user, active] = yield Promise.all([
            User_model_1.default.findOne({
                include: [
                    { model: Role_model_1.default, as: "role" },
                    { model: Institute_model_1.default, as: "institute" },
                ],
                where: { userId: token.userId },
            }),
            (0, session_service_1.sessionIsActive)(token.sid, token.userId),
        ]);
        if (!active)
            return unauthorized(res, "Your session has ended. Please sign in again.");
        const problem = (0, session_service_1.accountProblem)(user);
        if (problem || !user) {
            const { statusCode, message } = problem !== null && problem !== void 0 ? problem : { statusCode: http_status_1.default.UNAUTHORIZED, message: "User not found." };
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
            const userRole = ((_a = user.role) === null || _a === void 0 ? void 0 : _a.role) || "USER";
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
                UserPresenceSession_model_1.default.findOne({ where: { userId: user.userId } })
                    .then((session) => {
                    const now = new Date();
                    if (session) {
                        session.presenceStatus = "ONLINE";
                        session.lastActivityAt = now;
                        session.currentActivity = humanActivity;
                        session.save().catch(() => { });
                    }
                    else {
                        UserPresenceSession_model_1.default.create({
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
