import httpStatus from "http-status";
import UserModal from "../../models/User.model";
import PasswordReset from "../../models/PasswordReset.model";
import Role from "../../models/Role.model";
import EncryptPassword from "../../utils/encryption"
import { sendOtpEmail } from "../../utils/mailHelper" // your existing mailer
import config from "../../config/config"
import Helper from "../../utils/helper"
import { sequelize } from "../../config/sequelize"

// ─── Helper to get role name from roleId ───────────────────────────────────────
const getRoleName = async (roleId: number): Promise<string> => {
  try {
    const role = await Role.findOne({ where: { id: roleId } });
    return role?.role || "student"; // default to student if role not found
  } catch {
    return "student"; // fallback
  }
};

// ─── Credentials (new password + email) ──────────────────────────────────────

const genericResendMessage = "If an active account uses this email, new login details have been sent to it.";

// One public resend per account every 10 minutes, so nobody can keep resetting
// someone else's password. In-memory is enough: the window is short and a
// restart only re-opens one resend.
const RESEND_COOLDOWN_MS = 10 * 60 * 1000;
const lastResendAt = new Map<string, number>();

/**
 * Saves a new password for the user and emails it to the account's own address.
 * Both happen in one transaction: if the email can't be sent the password change
 * is rolled back, so nobody is left locked out with a password they never got.
 */
const signInFor = async (user: any) => {
  const roleName = String(await getRoleName(user.roleId)).toLowerCase();
  let loginUrl = `${config.frontendUrl}/auth/superadmin/signin`;
  let instituteName = "ViaExam Platform";
  if (user.instituteId) {
    const Institute = require("../../models/Institute.model").default;
    const institute = await Institute.findOne({ where: { instituteId: user.instituteId } });
    if (institute) {
      loginUrl = `${config.frontendUrl}/${institute.slug}/auth/signin`;
      instituteName = institute.instituteName;
    }
  }
  return { roleName, loginUrl, instituteName };
};

const issueCredentials = async (user: any, password: string): Promise<void> => {
  const { roleName, loginUrl, instituteName } = await signInFor(user);
  const encrypted = await EncryptPassword.encryptPassword(password);

  await sequelize.transaction(async (t) => {
    await user.update({ password: encrypted }, { transaction: t });
    // The mail helpers report failure by returning false instead of throwing.
    let sent: unknown;
    if (roleName === "admin" || roleName === "super_admin") {
      const { sendAdminCredentials } = require("../../utils/mailHelper");
      sent = await sendAdminCredentials({
        adminName: user.userName,
        adminEmail: user.emailId,
        adminPassword: password,
        instituteName: roleName === "super_admin" ? "ViaExam Platform" : instituteName,
        loginUrl,
        plan: roleName === "super_admin" ? "PLATFORM" : "PREMIUM",
      });
    } else {
      const { sendUserCredentials } = require("../../utils/mailHelper");
      sent = await sendUserCredentials({
        userName: user.userName,
        email: user.emailId,
        phone: user.phoneNumber,
        password,
        role: roleName.charAt(0).toUpperCase() + roleName.slice(1),
        loginUrl,
        kind: "reset",
      });
    }
    if (sent === false) throw new Error("The login details email could not be sent.");
  });
};

/**
 * Emails a user their login email and sign-in link, and leaves the password alone.
 * (The current password can't be sent: only its hash is stored.)
 */
const sendLoginDetails = async (user: any): Promise<boolean> => {
  const { roleName, loginUrl } = await signInFor(user);
  const { sendUserCredentials } = require("../../utils/mailHelper");
  return sendUserCredentials({
    userName: user.userName,
    email: user.emailId,
    phone: user.phoneNumber,
    password: null,
    role: roleName.charAt(0).toUpperCase() + roleName.slice(1),
    loginUrl,
    kind: "details",
  });
};

/** How an admin sends someone their login: a generated password, one they typed, or the details only. */
export type LoginMode = "generate" | "manual" | "details";

/**
 * Public "resend my login details" (sign-in page). The password is always
 * generated here — a caller can never choose it — and goes only to the
 * account's own inbox. The reply is the same whether or not the email exists,
 * so the form can't be used to discover who has an account.
 */
const resendCredentials = async (email: string): Promise<any> => {
  try {
    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!cleanEmail || cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Enter a valid email address." };
    }

    const user = await UserModal.findOne({ where: { emailId: cleanEmail, status: 1, isDeleted: false } });
    if (!user) return { error: false, statusCode: httpStatus.OK, message: genericResendMessage, data: {} };

    const last = lastResendAt.get(user.userId) ?? 0;
    if (Date.now() - last < RESEND_COOLDOWN_MS) {
      return {
        error: true,
        statusCode: httpStatus.TOO_MANY_REQUESTS,
        message: "New login details were sent a few minutes ago. Check your inbox (and spam) or try again in 10 minutes.",
      };
    }
    lastResendAt.set(user.userId, Date.now());

    await issueCredentials(user, Helper.generateTempPassword());
    return { error: false, statusCode: httpStatus.OK, message: genericResendMessage, data: {} };
  } catch (e: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Could not send login details. Please try again." };
  }
};

/**
 * School admin resets a teacher's / scanner's / student's password (optionally
 * to one they typed) and emails it to that user. Only users of the admin's own
 * institute, and never another admin.
 */
const adminResetCredentials = async (admin: any, email: string, password?: string, mode?: string): Promise<any> => {
  try {
    const cleanEmail = String(email ?? "").trim().toLowerCase();
    const user: any = await UserModal.findOne({
      where: { emailId: cleanEmail, isDeleted: false },
      include: [{ model: Role, as: "role" }],
    });
    if (!user || !admin?.instituteId || user.instituteId !== admin.instituteId) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "No user with this email in your institute." };
    }
    const targetRole = String(user.role?.role ?? "").toUpperCase();
    if (["ADMIN", "INSTITUTE_ADMIN", "SUPER_ADMIN"].includes(targetRole)) {
      return { error: true, statusCode: httpStatus.FORBIDDEN, message: "Admin passwords can't be reset from here." };
    }

    // Older callers send no mode: a password means "manual", none means "generate".
    const typed = password !== undefined && password !== null && String(password).trim() !== "";
    const how: LoginMode = mode === "details" || mode === "manual" || mode === "generate" ? mode : typed ? "manual" : "generate";

    if (how === "details") {
      if (Number(user.status) !== 1) {
        return { error: true, statusCode: httpStatus.CONFLICT, message: "This account is deactivated. Reactivate it before sending login details." };
      }
      const sent = await sendLoginDetails(user);
      if (sent === false) return { error: true, statusCode: httpStatus.BAD_GATEWAY, message: "The email could not be sent. Check the address and try again." };
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: `Login details sent to ${user.emailId}. Their password is unchanged.`,
        data: { email: user.emailId, mode: how },
      };
    }
    if (how === "manual" && !typed) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Enter the new password, or let one be generated." };
    }

    let nextPassword = Helper.generateTempPassword();
    if (how === "manual") {
      nextPassword = String(password).trim();
      const strong =
        nextPassword.length >= 8 &&
        nextPassword.length <= 64 &&
        /[A-Z]/.test(nextPassword) &&
        /[a-z]/.test(nextPassword) &&
        /\d/.test(nextPassword);
      if (!strong) {
        return {
          error: true,
          statusCode: httpStatus.BAD_REQUEST,
          message: "Password must be 8–64 characters with an uppercase letter, a lowercase letter and a number.",
        };
      }
    }

    await issueCredentials(user, nextPassword);
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Password updated and login details sent to ${user.emailId}.`,
      data: { email: user.emailId, mode: how },
    };
  } catch (e: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Could not reset the password. Please try again." };
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

// ─── Change Password for logged in user ─────────────────────────────────────────
const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<any> => {
  try {
    if (!currentPassword || !newPassword) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Both current password and new password are required.",
      };
    }

    if (newPassword.length < 6) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "New password must be at least 6 characters long.",
      };
    }

    const user = await UserModal.findOne({
      where: { userId, status: 1 },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "User account not found.",
      };
    }

    const isMatch = await EncryptPassword.isPasswordMatch(currentPassword, user.password);
    if (!isMatch) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Current password is incorrect.",
      };
    }

    const encrypted = await EncryptPassword.encryptPassword(newPassword);
    await user.update({ password: encrypted });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Password updated successfully.",
      data: {},
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Failed to change password: ${e.message}`,
    };
  }
};

export default { forgotPassword, verifyOtp, resetPassword, resendCredentials, adminResetCredentials, changePassword };