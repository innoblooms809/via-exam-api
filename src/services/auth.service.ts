import httpStatus from "http-status";
import UserModal from "../modals/User.modal";
import PasswordReset from "../modals/PasswordReset.modal";
import Role from "../modals/Role.modal";
import EncryptPassword from "../utils/encryption"
import { sendOtpEmail } from "../utils/mailHelper" // your existing mailer
import config from "../config/config"

// ─── Helper to get role name from roleId ───────────────────────────────────────
const getRoleName = async (roleId: number): Promise<string> => {
  try {
    const role = await Role.findOne({ where: { id: roleId } });
    return role?.role || "student"; // default to student if role not found
  } catch {
    return "student"; // fallback
  }
};

// ─── Helper to generate temporary password ────────────────────────────────────
const generateTempPassword = (): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

// ─── Resend Credentials for any user role ───────────────────────────────────────
const resendCredentials = async (email: string): Promise<any> => {
  try {
    // 1. Find user
    const user = await UserModal.findOne({
      where: { emailId: email, status: 1 },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "No active account found with this email.",
      };
    }

    // 2. Get user role
    const roleName = await getRoleName(user.roleId);

    // 3. Generate new temporary password
    const tempPassword = generateTempPassword();
    const encrypted = await EncryptPassword.encryptPassword(tempPassword);

    // 4. Update password in DB
    await user.update({ password: encrypted });

    // 5. Get institute info for login URL (if not super_admin)
    let loginUrl = `${config.frontendUrl}/auth/superadmin/signin`;
    let instituteName = "ViaExam Platform";

    if (user.instituteId) {
      const Institute = require("../modals/Institute.modal").default;
      const institute = await Institute.findOne({
        where: { instituteId: user.instituteId }
      });
      if (institute) {
        loginUrl = `${config.frontendUrl}/${institute.slug}/auth/signin`;
        instituteName = institute.instituteName;
      }
    }

    // 6. Send role-specific credentials email
    if (roleName === "admin" || roleName === "super_admin") {
      const { sendAdminCredentials } = require("../utils/mailHelper");
      await sendAdminCredentials({
        adminName: user.userName,
        adminEmail: user.emailId,
        adminPassword: tempPassword,
        instituteName: roleName === "super_admin" ? "ViaExam Platform" : instituteName,
        loginUrl,
        plan: roleName === "super_admin" ? "PLATFORM" : "PREMIUM",
      });
    } else {
      const { sendUserCredentials } = require("../utils/mailHelper");
      await sendUserCredentials({
        userName: user.userName,
        email: user.emailId,
        phone: user.phoneNumber,
        password: tempPassword,
        role: roleName.charAt(0).toUpperCase() + roleName.slice(1), // Capitalize
        loginUrl,
      });
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Credentials resent to ${email} successfully.`,
      data: { email: user.emailId },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── STEP 1: Send OTP ─────────────────────────────────────────────────────────
const forgotPassword = async (email: string): Promise<any> => {
  try {
    // 1. Check user exists
    const user = await UserModal.findOne({
      where: { emailId: email, status: 1 },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "No account found with this email.",
      };
    }

    // 2. Get user role for personalized email
    const roleName = await getRoleName(user.roleId);

    // 3. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // 4. Expire in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // 5. Invalidate any previous unused OTPs for this email
    await PasswordReset.update(
      { isUsed: true },
      { where: { email, isUsed: false } }
    );

    // 6. Save new OTP
    await PasswordReset.create({ email, otp, expiresAt });

    // 7. Send role-specific email
    await sendOtpEmail({
      toEmail: email,
      userName: user.userName,
      otp,
      role: roleName,
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `OTP sent to ${email}. Valid for 10 minutes.`,
      data: {},
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── STEP 2: Verify OTP (separate from password reset) ───────────────────────
const verifyOtp = async (email: string, otp: string): Promise<any> => {
  try {
    // 1. Find the OTP record
    const record = await PasswordReset.findOne({
      where: { email, otp, isUsed: false },
    });

    if (!record) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Invalid OTP. Please check and try again.",
      };
    }

    // 2. Check expiry
    if (new Date() > record.expiresAt) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "OTP has expired. Please request a new one.",
      };
    }

    // 3. Check if user still exists and is active
    const user = await UserModal.findOne({
      where: { emailId: email, status: 1 },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "User not found or account is inactive.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "OTP verified successfully.",
      data: { email: user.emailId },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── STEP 3: Reset Password (after OTP verification) ──────────────────────────
const resetPassword = async (
  email: string,
  otp: string,
  newPassword: string
): Promise<any> => {
  try {
    // 1. Find the OTP record
    const record = await PasswordReset.findOne({
      where: { email, otp, isUsed: false },
    });

    if (!record) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Invalid OTP.",
      };
    }

    // 2. Check expiry
    if (new Date() > record.expiresAt) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "OTP has expired. Please request a new one.",
      };
    }

    // 3. Find user
    const user = await UserModal.findOne({
      where: { emailId: email, status: 1 },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "User not found.",
      };
    }

    // 4. Encrypt + update password
    const encrypted = await EncryptPassword.encryptPassword(newPassword);
    await user.update({ password: encrypted });

    // 5. Mark OTP as used
    await record.update({ isUsed: true });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Password reset successfully. You can now log in.",
      data: {},
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

export default { forgotPassword, verifyOtp, resetPassword, resendCredentials };