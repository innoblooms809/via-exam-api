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
    try {
        const { emailId, password } = req.body;
        // CAPTCHA check — identical to your boilerplate
        // if (captcha !== req.session.captcha) {
        //   return res.status(400).json({ message: "Invalid CAPTCHA" });
        // }
        const result = yield user_service_1.default.viaExamUserLogin(emailId, password);
        if (result.error) {
            return res.status(result.statusCode).send(result);
        }
        // Reuse your existing tokenService — same call signature as your boilerplate
        if (result.error || !result.data) {
            return res.status(result.statusCode).send(result);
        }
        const token = yield token_service_1.default.generateUserAuthTokens(result.data.user);
        yield User_modal_1.default.update({ refreshToken: token.refresh.token }, { where: { userId: result.data.user.userId } });
        // Set tokens as httpOnly cookies
        res.cookie("accessToken", token.access.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            maxAge: config_1.default.jwt.accessExpirationMinutes * 60 * 1000,
            sameSite: "lax",
        });
        res.cookie("refreshToken", token.refresh.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            maxAge: config_1.default.jwt.refreshExpirationDays * 24 * 60 * 60 * 1000,
            sameSite: "lax",
        });
        // Send basic user data to frontend (exclude sensitive information)
        const userData = {
            userName: result.data.user.userName,
            userId: result.data.user.userId,
            emailId: result.data.user.emailId,
            phoneNumber: result.data.user.phoneNumber,
            roleId: result.data.user.roleId,
            instituteId: result.data.user.instituteId,
            status: result.data.user.status
        };
        return res.status(http_status_1.default.OK).send({
            error: false,
            statusCode: http_status_1.default.OK,
            message: "User logged in successfully",
            data: userData
        });
    }
    catch (error) {
        console.error(error);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            data: {},
            message: "Internal Server Error",
        });
    }
});
const refreshAccessToken = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const refreshToken = getCookieValue(req, "refreshToken");
        if (!refreshToken) {
            return res.status(http_status_1.default.BAD_REQUEST).json({
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Refresh token missing",
            });
        }
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(refreshToken, config_1.default.jwt.secret);
        }
        catch (err) {
            console.error("Invalid refresh token:", err.message);
            return res.status(http_status_1.default.FORBIDDEN).json({
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Invalid or expired refresh token",
            });
        }
        const userId = typeof decoded.sub === "object"
            ? (_a = decoded.sub) === null || _a === void 0 ? void 0 : _a.userId
            : (_b = decoded.sub) !== null && _b !== void 0 ? _b : decoded.userId;
        if (!userId) {
            return res.status(http_status_1.default.FORBIDDEN).json({
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Invalid refresh token payload",
            });
        }
        const user = yield User_modal_1.default.findOne({ where: { userId } });
        if (!user) {
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "User not found",
            });
        }
        if (user.refreshToken !== refreshToken) {
            return res.status(http_status_1.default.FORBIDDEN).json({
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Refresh token does not match",
            });
        }
        const token = yield token_service_1.default.generateUserAuthTokens(user);
        yield User_modal_1.default.update({ refreshToken: token.refresh.token }, { where: { userId: user.userId } });
        res.cookie("accessToken", token.access.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            maxAge: config_1.default.jwt.accessExpirationMinutes * 60 * 1000,
            sameSite: "lax",
        });
        res.cookie("refreshToken", token.refresh.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            maxAge: config_1.default.jwt.refreshExpirationDays * 24 * 60 * 60 * 1000,
            sameSite: "lax",
        });
        return res.status(http_status_1.default.OK).json({
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Access token refreshed successfully",
        });
    }
    catch (error) {
        console.error("Refresh token error:", error);
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
    try {
        const result = yield user_service_1.default.viaExamUserCreate(req);
        if (!result.error) {
            // Reuse your existing mail helper
            yield (0, mailHelper_1.sendEmailToNewUser)(Object.assign(Object.assign({}, req.body), { password: result.password }));
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
    try {
        // Clear access token cookie
        res.clearCookie("accessToken", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
        });
        res.clearCookie("refreshToken", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
        });
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
