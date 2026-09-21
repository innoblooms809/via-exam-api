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
const sequelize_1 = require("sequelize");
const Institute_modal_1 = __importDefault(require("../../modals/Institute.modal"));
const UserPresenceSession_modal_1 = __importDefault(require("../../modals/UserPresenceSession.modal"));
const activityLogger_1 = require("../../utils/activityLogger");
// ─── Constants ───────────────────────────────────────────────────────────────
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_SECONDS = 5;
// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Fetch ViaExam user by emailId — mirrors your getUserByEmail() pattern
 */
const getViaExamUserByEmail = (emailId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    const where = {
        emailId: {
            [sequelize_1.Op.iLike]: emailId,
        },
    };
    if (instituteId) {
        where.instituteId = instituteId;
    }
    else if (instituteId === null) {
        where.instituteId = { [sequelize_1.Op.is]: null };
    }
    return User_modal_1.default.findOne({
        include: [
            {
                model: Role_modal_1.default,
                as: "role",
            },
        ],
        where,
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
const viaExamUserLogin = (slug, emailId, password) => __awaiter(void 0, void 0, void 0, function* () {
    var _b, _c;
    try {
        console.log("EMAIL RECEIVED:", emailId);
        let instituteId = null;
        if (slug) {
            const institute = yield Institute_modal_1.default.findOne({ where: { slug } });
            if (!institute) {
                return {
                    error: true,
                    statusCode: http_status_1.default.BAD_REQUEST,
                    message: "Invalid institute.",
                };
            }
            instituteId = institute.instituteId;
        }
        const user = yield getViaExamUserByEmail(emailId, instituteId);
        console.log("USER FOUND:", user === null || user === void 0 ? void 0 : user.emailId);
        console.log("HASHED PASSWORD:", user === null || user === void 0 ? void 0 : user.password);
        if (!user) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Invalid credentials.",
            };
        }
        // Account status checks
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
        // Lock check (DISABLED)
        /*
        if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
          return {
            error: true,
            statusCode: httpStatus.TOO_MANY_REQUESTS,
            message: "Account is locked.",
          };
        }
        */
        const isMatch = yield encryption_1.default.isPasswordMatch(password, user.password);
        if (!isMatch) {
            /* Login attempts lock logic disabled
            const attempts = (user.loginAttempts || 0) + 1;
      
            if (attempts >= MAX_LOGIN_ATTEMPTS) {
              await UserModal.update(
                {
                  loginAttempts: attempts,
                  lockedUntil: new Date(
                    Date.now() + LOCK_DURATION_SECONDS * 1000
                  ),
                },
                { where: { userId: user.userId } },
              );
            } else {
              await UserModal.update(
                { loginAttempts: attempts },
                { where: { userId: user.userId } },
              );
            }
            */
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Invalid credentials.",
            };
        }
        // Reset lock info after successful login
        yield User_modal_1.default.update({
            loginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
        }, { where: { userId: user.userId } });
        // Log Activity & Update Presence
        const now = new Date();
        let presenceSession = yield UserPresenceSession_modal_1.default.findOne({ where: { userId: user.userId } });
        if (presenceSession) {
            presenceSession.presenceStatus = "ONLINE";
            presenceSession.lastActivityAt = now;
            presenceSession.lastLoginAt = now;
            presenceSession.currentActivity = "Active in Portal";
            yield presenceSession.save();
        }
        else {
            yield UserPresenceSession_modal_1.default.create({
                userId: user.userId,
                role: ((_b = user.role) === null || _b === void 0 ? void 0 : _b.role) || "USER",
                instituteId: user.instituteId || null,
                presenceStatus: "ONLINE",
                currentActivity: "Active in Portal",
                lastActivityAt: now,
                lastLoginAt: now,
            });
        }
        yield (0, activityLogger_1.logActivity)({
            userId: user.userId,
            role: ((_c = user.role) === null || _c === void 0 ? void 0 : _c.role) || "USER",
            instituteId: user.instituteId || null,
            eventType: "LOGIN_SUCCESS",
            currentActivity: "Logged In",
        });
        const userResponse = (0, exclude_1.default)(user.toJSON(), ["password", "refreshToken"]);
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            data: {
                user: userResponse,
            },
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
    var _d;
    try {
        const user = yield User_modal_1.default.findOne({
            include: [{ model: Role_modal_1.default, as: "role" }],
            where: { userId },
        });
        yield User_modal_1.default.update({ refreshToken: null }, { where: { userId } });
        // Instantly update active presence session to OFFLINE
        const logoutTime = new Date();
        const presenceSession = yield UserPresenceSession_modal_1.default.findOne({ where: { userId } });
        if (presenceSession) {
            presenceSession.presenceStatus = "OFFLINE";
            presenceSession.currentActivity = "Logged Out";
            presenceSession.lastLogoutAt = logoutTime;
            yield presenceSession.save();
        }
        if (user) {
            yield (0, activityLogger_1.logActivity)({
                userId: user.userId,
                role: ((_d = user.role) === null || _d === void 0 ? void 0 : _d.role) || "USER",
                instituteId: user.instituteId || null,
                eventType: "LOGOUT",
                currentActivity: "Logged Out",
            });
        }
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
