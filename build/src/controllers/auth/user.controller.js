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
const http_status_1 = __importDefault(require("http-status"));
const svg_captcha_1 = __importDefault(require("svg-captcha")); // same as your boilerplate
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const token_service_1 = __importDefault(require("../../services/token.service")); // reuse your existing tokenService
const user_service_1 = __importDefault(require("../../services/auth/user.service"));
const mailHelper_1 = require("../../utils/mailHelper"); // reuse your mail helper
const config_1 = __importDefault(require("../../config/config"));
const User_modal_1 = __importDefault(require("../../modals/User.modal"));
const UserPresenceSession_modal_1 = __importDefault(require("../../modals/UserPresenceSession.modal"));
const logger_1 = __importDefault(require("../../config/logger"));
const Role_modal_1 = __importDefault(require("../../modals/Role.modal"));
const auth_1 = require("../../middlewares/auth");
const getCookieValue = (req, name) => {
    var _a;
    const cookies = req.cookies;
    if (cookies === null || cookies === void 0 ? void 0 : cookies[name]) {
        return cookies[name];
    }
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
        return undefined;
    }
    return (_a = cookieHeader
        .split(";")
        .map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith(`${name}=`))) === null || _a === void 0 ? void 0 : _a.split("=").slice(1).join("=");
};
const getRoleCookieNames = (roleStr) => {
    const cleanRole = String(roleStr || "").toUpperCase().replace(/[\s_-]+/g, "");
    if (cleanRole === "SUPERADMIN") {
        return { access: "superAdminToken", refresh: "superAdminRefreshToken" };
    }
    if (cleanRole === "ADMIN") {
        return { access: "adminToken", refresh: "adminRefreshToken" };
    }
    if (cleanRole === "TEACHER") {
        return { access: "teacherToken", refresh: "teacherRefreshToken" };
    }
    if (cleanRole === "STUDENT") {
        return { access: "studentToken", refresh: "studentRefreshToken" };
    }
    if (cleanRole === "SCANNER") {
        return { access: "scannerToken", refresh: "scannerRefreshToken" };
    }
    return { access: "accessToken", refresh: "refreshToken" };
};
// ─── GET CAPTCHA ──────────────────────────────────────────────────────────────
/**
 * GET /api/viaexam/auth/captcha
 * Identical pattern to your getCaptcha()
 */
const getCaptcha = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const captcha = svg_captcha_1.default.create();
    req.session.captcha = captcha.text;
    res.set("Content-Type", "image/svg+xml");
    res.send(captcha.data);
});
// ─── LOGIN ────────────────────────────────────────────────────────────────────
/**
 * POST /api/viaexam/auth/login
 *
 * Body: { emailId, mobileNo, type, password, captcha }
 * type 1 = email, type 2 = mobile  ← matches your existing pattern
 *
 * Reuses: your tokenService.generateUserAuthTokens()
 */
const loginViaExamUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { slug, emailId, password } = req.body;
        // CAPTCHA check — identical to your boilerplate
        // if (captcha !== req.session.captcha) {
        //   return res.status(400).json({ message: "Invalid CAPTCHA" });
        // }
        const result = yield user_service_1.default.viaExamUserLogin(slug, emailId, password);
        if (result.error) {
            return res.status(result.statusCode).send(result);
        }
        // Reuse your existing tokenService — same call signature as your boilerplate
        if (result.error || !result.data) {
            return res.status(result.statusCode).send(result);
        }
        const token = yield token_service_1.default.generateUserAuthTokens(result.data.user);
        yield User_modal_1.default.update({ refreshToken: token.refresh.token }, { where: { userId: result.data.user.userId } });
        const cookieNames = getRoleCookieNames(((_a = result.data.user.role) === null || _a === void 0 ? void 0 : _a.role) || "");
        // Set tokens as httpOnly cookies (role-scoped to avoid session collisions)
        res.cookie(cookieNames.access, token.access.token, {
            httpOnly: true,
            secure: false,
            // secure: process.env.NODE_ENV === "production",
            maxAge: config_1.default.jwt.accessExpirationMinutes * 60 * 1000,
            sameSite: "lax",
        });
        res.cookie(cookieNames.refresh, token.refresh.token, {
            httpOnly: true,
            secure: false,
            maxAge: config_1.default.jwt.refreshExpirationDays * 24 * 60 * 60 * 1000,
            sameSite: "lax",
        });
        // Send user data and access tokens to frontend
        const userData = {
            userName: result.data.user.userName,
            userId: result.data.user.userId,
            emailId: result.data.user.emailId,
            phoneNumber: result.data.user.phoneNumber,
            roleId: result.data.user.roleId,
            role: ((_c = (_b = result.data.user.role) === null || _b === void 0 ? void 0 : _b.role) === null || _c === void 0 ? void 0 : _c.toLowerCase()) || null,
            instituteId: result.data.user.instituteId,
            status: result.data.user.status,
            token: token.access.token,
            accessToken: token.access.token,
            refreshToken: token.refresh.token,
        };
        return res.status(http_status_1.default.OK).send({
            error: false,
            statusCode: http_status_1.default.OK,
            message: "User logged in successfully",
            data: userData,
        });
    }
    catch (error) {
        logger_1.default.error(`Login error: ${error}`);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            data: {},
            message: "Internal Server Error",
        });
    }
});
const refreshAccessToken = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _d, _e, _f, _g, _h;
    try {
        const superAdminRefresh = getCookieValue(req, "superAdminRefreshToken");
        const adminRefresh = getCookieValue(req, "adminRefreshToken");
        const teacherRefresh = getCookieValue(req, "teacherRefreshToken");
        const studentRefresh = getCookieValue(req, "studentRefreshToken");
        const scannerRefresh = getCookieValue(req, "scannerRefreshToken");
        const defaultRefresh = getCookieValue(req, "refreshToken");
        const bodyRefresh = typeof ((_d = req.body) === null || _d === void 0 ? void 0 : _d.refreshToken) === "string" ? req.body.refreshToken : undefined;
        const authRole = (0, auth_1.resolveRequestAuthRole)(req);
        const roleRefreshByKey = {
            superadmin: superAdminRefresh,
            admin: adminRefresh,
            teacher: teacherRefresh,
            student: studentRefresh,
            scanner: scannerRefresh,
        };
        const candidates = [
            bodyRefresh,
            authRole ? roleRefreshByKey[authRole] : undefined,
            !authRole ? adminRefresh : undefined,
            !authRole ? teacherRefresh : undefined,
            !authRole ? superAdminRefresh : undefined,
            !authRole ? studentRefresh : undefined,
            !authRole ? scannerRefresh : undefined,
            defaultRefresh,
        ].filter((value, index, list) => !!value && list.indexOf(value) === index);
        if (!candidates.length) {
            return res.status(http_status_1.default.BAD_REQUEST).json({
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Refresh token missing",
            });
        }
        let refreshToken;
        let decoded;
        for (const candidate of candidates) {
            try {
                decoded = jsonwebtoken_1.default.verify(candidate, config_1.default.jwt.secret);
                refreshToken = candidate;
                break;
            }
            catch (_j) {
                // try next candidate (stale tab token vs rotated cookie)
            }
        }
        if (!refreshToken || !decoded) {
            logger_1.default.error("Invalid refresh token: no usable candidate");
            return res.status(http_status_1.default.FORBIDDEN).json({
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Invalid or expired refresh token",
            });
        }
        const userId = typeof decoded.sub === "object"
            ? (_e = decoded.sub) === null || _e === void 0 ? void 0 : _e.userId
            : (_f = decoded.sub) !== null && _f !== void 0 ? _f : decoded.userId;
        if (!userId) {
            return res.status(http_status_1.default.FORBIDDEN).json({
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Invalid refresh token payload",
            });
        }
        const user = yield User_modal_1.default.findOne({
            where: { userId },
            include: [{ model: Role_modal_1.default, as: "role" }],
        });
        if (!user) {
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "User not found",
            });
        }
        const matchingStored = candidates.find((candidate) => candidate === user.refreshToken);
        if (matchingStored) {
            refreshToken = matchingStored;
        }
        const isSameUser = ((_g = decoded.sub) === null || _g === void 0 ? void 0 : _g.userId) === user.userId ||
            decoded.sub === user.userId;
        if (!isSameUser || !user.refreshToken || user.refreshToken !== refreshToken) {
            return res.status(http_status_1.default.FORBIDDEN).json({
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Invalid or revoked refresh token",
            });
        }
        const token = yield token_service_1.default.generateUserAuthTokens(user);
        yield User_modal_1.default.update({ refreshToken: token.refresh.token }, { where: { userId: user.userId } });
        const cookieNames = getRoleCookieNames(((_h = user.role) === null || _h === void 0 ? void 0 : _h.role) || "");
        res.cookie(cookieNames.access, token.access.token, {
            httpOnly: true,
            secure: false,
            maxAge: config_1.default.jwt.accessExpirationMinutes * 60 * 1000,
            sameSite: "lax",
        });
        res.cookie(cookieNames.refresh, token.refresh.token, {
            httpOnly: true,
            secure: false,
            maxAge: config_1.default.jwt.refreshExpirationDays * 24 * 60 * 60 * 1000,
            sameSite: "lax",
        });
        return res.status(http_status_1.default.OK).json({
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Access token refreshed successfully",
            data: {
                token: token.access.token,
                accessToken: token.access.token,
                refreshToken: token.refresh.token,
            },
        });
    }
    catch (error) {
        logger_1.default.error(`Refresh token error: ${error}`);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal server error",
        });
    }
});
// ─── CREATE USER (Super Admin seeding / admin panel) ─────────────────────────
/**
 * POST /api/viaexam/auth/create-user
 * Mirrors your createUser() — also sends welcome email
 */
const createViaExamUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _k, _l;
    try {
        const result = yield user_service_1.default.viaExamUserCreate(req);
        if (!result.error) {
            const slug = (_l = (_k = req.viaExamUser) === null || _k === void 0 ? void 0 : _k.institute) === null || _l === void 0 ? void 0 : _l.slug;
            const loginUrl = slug
                ? `${config_1.default.frontendUrl}/${slug}/auth/signin`
                : `${config_1.default.frontendUrl}/auth/signin`;
            (0, mailHelper_1.sendUserCredentials)({
                userName: req.body.userName ||
                    `${req.body.firstName || ""} ${req.body.lastName || ""}`.trim(),
                email: req.body.emailId || req.body.email,
                phone: req.body.phoneNumber || "",
                password: result.password,
                role: req.body.role || "User",
                loginUrl,
            }).catch((err) => {
                logger_1.default.error(`Background user email dispatch failed: ${err}`);
            });
        }
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            data: {},
            message: "Internal Server Error",
        });
    }
});
// ─── LOGOUT ───────────────────────────────────────────────────────────────────
/**
 * POST /api/viaexam/auth/logout
 * Protected by authenticate middleware — reads userId from req.viaExamUser
 */
const logoutViaExamUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _m, _o, _p;
    try {
        // Clear only this user's role cookies so other tabs stay logged in
        const cookieOpts = { httpOnly: true, secure: false, sameSite: "lax" };
        const cookieNames = getRoleCookieNames(((_o = (_m = req.viaExamUser) === null || _m === void 0 ? void 0 : _m.role) === null || _o === void 0 ? void 0 : _o.role) || "");
        res.clearCookie(cookieNames.access, cookieOpts);
        res.clearCookie(cookieNames.refresh, cookieOpts);
        if (cookieNames.access !== "accessToken") {
            res.clearCookie("accessToken", cookieOpts);
            res.clearCookie("refreshToken", cookieOpts);
        }
        if ((_p = req.viaExamUser) === null || _p === void 0 ? void 0 : _p.userId) {
            UserPresenceSession_modal_1.default.update({ presenceStatus: "OFFLINE", currentActivity: "Logged Out", lastLogoutAt: new Date() }, { where: { userId: req.viaExamUser.userId } }).catch(() => { });
        }
        const result = yield user_service_1.default.viaExamUserLogout(req.viaExamUser.userId);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            data: {},
            message: "Internal Server Error",
        });
    }
});
// ─── GET PROFILE ──────────────────────────────────────────────────────────────
/**
 * GET /api/viaexam/auth/me
 * Protected — reads userId from req.viaExamUser (set by authenticate middleware)
 */
const getViaExamProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield user_service_1.default.viaExamGetProfile(req.viaExamUser.userId);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            data: {},
            message: "Internal Server Error",
        });
    }
});
exports.default = {
    getCaptcha,
    loginViaExamUser,
    refreshAccessToken,
    createViaExamUser,
    logoutViaExamUser,
    getViaExamProfile,
};
