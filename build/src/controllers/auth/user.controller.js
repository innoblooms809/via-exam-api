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
const user_service_1 = __importDefault(require("../../services/auth/user.service"));
const mailHelper_1 = require("../../utils/mailHelper"); // queued; retried while SMTP is down
const config_1 = __importDefault(require("../../config/config"));
const logger_1 = __importDefault(require("../../config/logger"));
const auth_1 = require("../../middlewares/auth");
const session_service_1 = require("../../services/auth/session.service");
// ─── GET CAPTCHA ──────────────────────────────────────────────────────────────
/**
 * GET /api/viaexam/auth/captcha
 * Identical pattern to your getCaptcha()
 */
const getCaptcha = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const captcha = svg_captcha_1.default.create();
    // req.session.captcha = captcha.text; // Commented out: session middleware disabled
    res.set("Content-Type", "image/svg+xml");
    res.send(captcha.data);
});
// ─── LOGIN ────────────────────────────────────────────────────────────────────
/**
 * POST /v1/user/login   Body: { slug, emailId, password }
 *
 * Starts a session (services/auth/session.service). Its tokens go into httpOnly cookies, where the
 * page's JavaScript can't read them; the response body carries the profile only.
 */
const loginViaExamUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { slug, emailId, password } = req.body;
        const result = yield user_service_1.default.viaExamUserLogin(slug, emailId, password);
        if (result.error || !result.data) {
            return res.status(result.statusCode).send(result);
        }
        const user = result.data.user;
        const role = ((_a = user.role) === null || _a === void 0 ? void 0 : _a.role) || "";
        // This browser's earlier session for the role ends: its cookies are replaced now.
        yield (0, session_service_1.endReplacedSession)(req, role);
        (0, session_service_1.setAuthCookies)(res, role, yield (0, session_service_1.startSession)(user.userId, req));
        return res.status(http_status_1.default.OK).send({
            error: false,
            statusCode: http_status_1.default.OK,
            message: "User logged in successfully",
            data: {
                userName: user.userName,
                userId: user.userId,
                emailId: user.emailId,
                phoneNumber: user.phoneNumber,
                roleId: user.roleId,
                role: role.toLowerCase() || null,
                instituteId: user.instituteId,
                status: user.status,
            },
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
// ─── REFRESH ──────────────────────────────────────────────────────────────────
/**
 * POST /v1/user/refresh-token   No body: the refresh token is the httpOnly cookie the browser sends
 * only to this path. New cookies on success; the body never carries a token.
 */
const refreshAccessToken = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _b, _c;
    try {
        const role = (0, auth_1.resolveRequestAuthRole)(req);
        const result = yield (0, session_service_1.refreshSession)(req, role);
        if (!result.ok) {
            if (role)
                (0, session_service_1.clearAuthCookies)(res, role);
            const { statusCode, message } = (_b = result.problem) !== null && _b !== void 0 ? _b : {
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: result.reason === "reused"
                    ? "For your security this session was signed out. Please sign in again."
                    : "Your session has ended. Please sign in again.",
            };
            return res.status(statusCode).json({ error: true, statusCode, message });
        }
        (0, session_service_1.setAuthCookies)(res, (_c = result.user.role) === null || _c === void 0 ? void 0 : _c.role, result);
        return res.status(http_status_1.default.OK).json({
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Session refreshed.",
            data: {},
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
    var _d, _e;
    try {
        const result = yield user_service_1.default.viaExamUserCreate(req);
        if (!result.error) {
            const slug = (_e = (_d = req.viaExamUser) === null || _d === void 0 ? void 0 : _d.institute) === null || _e === void 0 ? void 0 : _e.slug;
            const loginUrl = slug
                ? `${config_1.default.frontendUrl}/${slug}/auth/signin`
                : `${config_1.default.frontendUrl}/auth/signin`;
            void (0, mailHelper_1.queueUserCredentials)({
                userName: req.body.userName ||
                    `${req.body.firstName || ""} ${req.body.lastName || ""}`.trim(),
                email: req.body.emailId || req.body.email,
                phone: req.body.phoneNumber || "",
                password: result.password,
                role: req.body.role || "User",
                loginUrl,
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
 * POST /v1/user/logout   Ends this session and clears its cookies; the user's other sessions
 * (another browser, another role in this one) stay signed in.
 */
const logoutViaExamUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _f, _g;
    try {
        (0, session_service_1.clearAuthCookies)(res, (_g = (_f = req.viaExamUser) === null || _f === void 0 ? void 0 : _f.role) === null || _g === void 0 ? void 0 : _g.role);
        if (req.authSessionId)
            yield (0, session_service_1.endSession)(req.authSessionId, "logout");
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
/** POST /v1/user/logout-all   Ends every session of this user, this one included. */
const logoutEverywhere = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _h, _j;
    try {
        const sessions = yield (0, session_service_1.endAllSessions)(req.viaExamUser.userId, "logout-all");
        (0, session_service_1.clearAuthCookies)(res, (_j = (_h = req.viaExamUser) === null || _h === void 0 ? void 0 : _h.role) === null || _j === void 0 ? void 0 : _j.role);
        yield user_service_1.default.viaExamUserLogout(req.viaExamUser.userId);
        return res.status(http_status_1.default.OK).send({
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Signed out on every device.",
            data: { sessions },
        });
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
/**
 * PUT /api/viaexam/auth/me
 * Protected — updates profile for current user
 */
const updateViaExamProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield user_service_1.default.viaExamUpdateProfile(req.viaExamUser.userId, req.body, req.files);
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
    logoutEverywhere,
    getViaExamProfile,
    updateViaExamProfile,
};
