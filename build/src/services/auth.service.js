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
const Role_modal_1 = __importDefault(require("../modals/Role.modal"));
const encryption_1 = __importDefault(require("../utils/encryption"));
const mailHelper_1 = require("../utils/mailHelper"); // your existing mailer
const config_1 = __importDefault(require("../config/config"));
// ─── Helper to get role name from roleId ───────────────────────────────────────
const getRoleName = (roleId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const role = yield Role_modal_1.default.findOne({ where: { id: roleId } });
        return (role === null || role === void 0 ? void 0 : role.role) || "student"; // default to student if role not found
    }
    catch (_a) {
        return "student"; // fallback
    }
});
// ─── Helper to generate temporary password ────────────────────────────────────
const generateTempPassword = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let password = "";
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
};
// ─── Resend Credentials for any user role ───────────────────────────────────────
const resendCredentials = (email) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. Find user
        const user = yield User_modal_1.default.findOne({
            where: { emailId: email, status: 1 },
        });
        if (!user) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "No active account found with this email.",
            };
        }
        // 2. Get user role
        const roleName = yield getRoleName(user.roleId);
        // 3. Generate new temporary password
        const tempPassword = generateTempPassword();
        const encrypted = yield encryption_1.default.encryptPassword(tempPassword);
        // 4. Update password in DB
        yield user.update({ password: encrypted });
        // 5. Get institute info for login URL (if not super_admin)
        let loginUrl = `${config_1.default.frontendUrl}/auth/superadmin/signin`;
        let instituteName = "ViaExam Platform";
        if (user.instituteId) {
            const Institute = require("../modals/Institute.modal").default;
            const institute = yield Institute.findOne({
                where: { instituteId: user.instituteId }
            });
            if (institute) {
                loginUrl = `${config_1.default.frontendUrl}/${institute.slug}/auth/signin`;
                instituteName = institute.instituteName;
            }
        }
        // 6. Send role-specific credentials email
        if (roleName === "admin" || roleName === "super_admin") {
            const { sendAdminCredentials } = require("../utils/mailHelper");
            yield sendAdminCredentials({
                adminName: user.userName,
                adminEmail: user.emailId,
                adminPassword: tempPassword,
                instituteName: roleName === "super_admin" ? "ViaExam Platform" : instituteName,
                loginUrl,
                plan: roleName === "super_admin" ? "PLATFORM" : "PREMIUM",
            });
        }
        else {
            const { sendUserCredentials } = require("../utils/mailHelper");
            yield sendUserCredentials({
                userName: user.userName,
                email: user.emailId,
                phone: user.phoneNumber,
                password: tempPassword,
                role: roleName.charAt(0).toUpperCase() + roleName.slice(1),
                loginUrl,
            });
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: `Credentials resent to ${email} successfully.`,
            data: { email: user.emailId },
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
        // 2. Get user role for personalized email
        const roleName = yield getRoleName(user.roleId);
        // 3. Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        // 4. Expire in 10 minutes
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        // 5. Invalidate any previous unused OTPs for this email
        yield PasswordReset_modal_1.default.update({ isUsed: true }, { where: { email, isUsed: false } });
        // 6. Save new OTP
        yield PasswordReset_modal_1.default.create({ email, otp, expiresAt });
        // 7. Send role-specific email
        yield (0, mailHelper_1.sendOtpEmail)({
            toEmail: email,
            userName: user.userName,
            otp,
            role: roleName,
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
// ─── STEP 2: Verify OTP (separate from password reset) ───────────────────────
const verifyOtp = (email, otp) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. Find the OTP record
        const record = yield PasswordReset_modal_1.default.findOne({
            where: { email, otp, isUsed: false },
        });
        if (!record) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Invalid OTP. Please check and try again.",
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
        // 3. Check if user still exists and is active
        const user = yield User_modal_1.default.findOne({
            where: { emailId: email, status: 1 },
        });
        if (!user) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "User not found or account is inactive.",
            };
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "OTP verified successfully.",
            data: { email: user.emailId },
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
// ─── STEP 3: Reset Password (after OTP verification) ──────────────────────────
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
exports.default = { forgotPassword, verifyOtp, resetPassword, resendCredentials };
