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
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const PasswordReset_modal_1 = __importDefault(require("../modals/PasswordReset.modal"));
const encryption_1 = __importDefault(require("../utils/encryption"));
const mailHelper_1 = require("../utils/mailHelper"); // your existing mailer
// ─── STEP 1: Send OTP ─────────────────────────────────────────────────────────
const forgotPassword = (email) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. Check user exists
        const user = yield User_modal_1.default.findOne({
            where: { emailId: email, status: 1 },
        });
        if (!user) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "No account found with this email.",
            };
        }
        // 2. Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        // 3. Expire in 10 minutes
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        // 4. Invalidate any previous unused OTPs for this email
        yield PasswordReset_modal_1.default.update({ isUsed: true }, { where: { email, isUsed: false } });
        // 5. Save new OTP
        yield PasswordReset_modal_1.default.create({ email, otp, expiresAt });
        // 6. Send email
        yield (0, mailHelper_1.sendOtpEmail)({
            toEmail: email,
            userName: user.userName,
            otp,
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: `OTP sent to ${email}. Valid for 10 minutes.`,
            data: {},
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── STEP 2: Verify OTP + Reset Password ─────────────────────────────────────
const resetPassword = (email, otp, newPassword) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. Find the OTP record
        const record = yield PasswordReset_modal_1.default.findOne({
            where: { email, otp, isUsed: false },
        });
        if (!record) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Invalid OTP.",
            };
        }
        // 2. Check expiry
        if (new Date() > record.expiresAt) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "OTP has expired. Please request a new one.",
            };
        }
        // 3. Find user
        const user = yield User_modal_1.default.findOne({
            where: { emailId: email, status: 1 },
        });
        if (!user) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "User not found.",
            };
        }
        // 4. Encrypt + update password
        const encrypted = yield encryption_1.default.encryptPassword(newPassword);
        yield user.update({ password: encrypted });
        // 5. Mark OTP as used
        yield record.update({ isUsed: true });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Password reset successfully. You can now log in.",
            data: {},
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
exports.default = { forgotPassword, resetPassword };
