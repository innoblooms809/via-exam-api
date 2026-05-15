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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_status_1 = __importDefault(require("http-status"));
const User_modal_1 = __importDefault(require("../../modals/User.modal"));
const Role_modal_1 = __importDefault(require("../../modals/Role.modal"));
const encryption_1 = __importDefault(require("../../utils/encryption")); // reuse your existing utility
const helper_1 = __importDefault(require("../../utils/helper")); // reuse your existing utility
const exclude_1 = __importDefault(require("../../utils/exclude")); // reuse your existing utility
// ─── Constants ───────────────────────────────────────────────────────────────
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 30;
// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Fetch ViaExam user by emailId — mirrors your getUserByEmail() pattern
 */
const getViaExamUserByEmail = (emailId) => __awaiter(void 0, void 0, void 0, function* () {
    return User_modal_1.default.findOne({
        include: [
            {
                model: Role_modal_1.default,
                as: "role",
            },
        ],
        where: { emailId: emailId },
    });
});
/**
 * Fetch ViaExam user by phoneNumber — mirrors your getUserByMobile() pattern
 */
const getViaExamUserByMobile = (phoneNumber) => __awaiter(void 0, void 0, void 0, function* () {
    return User_modal_1.default.findOne({
        include: [
            {
                model: Role_modal_1.default,
                as: "role",
            },
        ],
        where: { phoneNumber: phoneNumber },
    });
});
// ─── Service Functions ────────────────────────────────────────────────────────
/**
 * Create Super Admin user
 * Called once during initial setup — mirrors your userCreate() pattern
 */
const viaExamUserCreate = (req) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const conflictFields = [];
        const existUserEmail = yield getViaExamUserByEmail(req.body.emailId);
        const existUserMobile = yield getViaExamUserByMobile(req.body.phoneNumber);
        if (existUserEmail)
            conflictFields.push("email");
        if (existUserMobile)
            conflictFields.push("mobile");
        if (conflictFields.length > 0) {
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                data: {},
                message: `This ${conflictFields.join(" & ")} is already registered.`,
            };
        }
        // Reuse your existing helpers
        const password = yield helper_1.default.generatePassword();
        const encryptedPassword = yield encryption_1.default.encryptPassword(password);
        const userId = yield helper_1.default.generateUserId();
        req.body.password = encryptedPassword;
        req.body.userId = userId;
        const newUser = yield User_modal_1.default.create(req.body);
        const _a = newUser.toJSON(), { password: _ } = _a, userResponse = __rest(_a, ["password"]);
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            data: userResponse,
            password,
            message: "ViaExam user created successfully.",
        };
    }
    catch (e) {
        console.error(e);
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            data: {},
            message: `Something went wrong: ${e.message}`,
        };
    }
});
/**
 * ViaExam login — mirrors your userLogin() pattern exactly.
 * type 1 = email login, type 2 = mobile login
 * Adds: account lockout, status checks
 */
const viaExamUserLogin = (emailId, password) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield getViaExamUserByEmail(emailId);
        if (!user) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Invalid credentials.",
            };
        }
        // status check
        if (user.status === 0) {
            return {
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: "Your account is inactive.",
            };
        }
        if (user.status === 2) {
            return {
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: "Account suspended.",
            };
        }
        // lock check (SAFE VERSION)
        if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
            return {
                error: true,
                statusCode: http_status_1.default.TOO_MANY_REQUESTS,
                message: "Account is locked.",
            };
        }
        const isMatch = yield encryption_1.default.isPasswordMatch(password, user.password);
        if (!isMatch) {
            const attempts = (user.loginAttempts || 0) + 1;
            if (attempts >= MAX_LOGIN_ATTEMPTS) {
                yield User_modal_1.default.update({
                    loginAttempts: attempts,
                    lockedUntil: new Date(Date.now() + LOCK_DURATION_MINUTES * 60000),
                }, { where: { userId: user.userId } });
            }
            else {
                yield User_modal_1.default.update({ loginAttempts: attempts }, { where: { userId: user.userId } });
            }
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Invalid credentials.",
            };
        }
        yield User_modal_1.default.update({
            loginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
        }, { where: { userId: user.userId } });
        const userResponse = (0, exclude_1.default)(user.toJSON(), ["password", "refreshToken"]);
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            data: { user: userResponse },
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            message: e.message,
        };
    }
});
/**
 * Logout — store/clear refresh token (mirrors your token invalidation pattern)
 */
const viaExamUserLogout = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield User_modal_1.default.update({ refreshToken: null }, { where: { userId } });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            data: {},
            message: "Logged out successfully.",
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            data: {},
            message: `Something went wrong: ${e.message}`,
        };
    }
});
/**
 * Get ViaExam user profile by userId
 */
const viaExamGetProfile = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield User_modal_1.default.findOne({
            include: [{ model: Role_modal_1.default, as: "role" }],
            where: { userId },
        });
        if (!user) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                data: {},
                message: "User not found.",
            };
        }
        const userResponse = (0, exclude_1.default)(user.toJSON(), ["password", "refreshToken"]);
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            data: userResponse,
            message: "Profile fetched successfully.",
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            data: {},
            message: e.message,
        };
    }
});
exports.default = {
    viaExamUserCreate,
    viaExamUserLogin,
    viaExamUserLogout,
    viaExamGetProfile,
    getViaExamUserByEmail, // exported so controller/token service can use it
};
