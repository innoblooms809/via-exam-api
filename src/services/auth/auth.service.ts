import httpStatus from "http-status";
import { randomInt } from "crypto";
import UserModal from "../../models/User.model";
import PasswordReset from "../../models/PasswordReset.model";
import Role from "../../models/Role.model";
import EncryptPassword from "../../utils/encryption"
import { cancelQueuedEmail, composeAdminCredentials, composeOtpEmail, composeUserCredentials, queueEmail, type QueuedEmail } from "../../utils/mailHelper"
import { digestSecret, verifySecret } from "../../utils/dataProtection"
import config from "../../config/config"
import Helper from "../../utils/helper"
import { sequelize } from "../../config/sequelize"
import { Op, QueryTypes, col, fn, where as sqlWhere } from "sequelize"

/**
 * Matches a user's email whatever its case. New accounts are stored lowercased, but older
 * ones kept their capitals ("Aditya4@gmail.com"), so an exact match on the lowercased
 * input missed them. Sign-in already matches case-insensitively.
 */
const emailIs = (email: string) => ({
  [Op.and]: [sqlWhere(fn("lower", col(`${UserModal.name}.emailId`)), String(email ?? "").trim().toLowerCase())],
});

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

/** The user's role, sign-in page and institute name, for the login-details email. */
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

/** The admin who asked, told in the app if the email can't be sent (needs the user's institute). */
const notifyOf = (requestedBy: any, user: any) =>
  requestedBy?.userId && user?.instituteId ? { userId: String(requestedBy.userId), instituteId: String(user.instituteId) } : null;

/**
 * Queues the email with the new password. The password is saved only once the mail server has
 * accepted that email (utils/mailHelper), so nobody is left locked out with a password they never
 * got. One at a time per user: while one is queued, another is refused (`duplicate`).
 */
const issueCredentials = async (user: any, password: string, requestedBy?: any): Promise<QueuedEmail> => {
  const { roleName, loginUrl, instituteName } = await signInFor(user);
  const hash = await EncryptPassword.encryptPassword(password);
  const message =
    roleName === "admin" || roleName === "super_admin"
      ? composeAdminCredentials({
          adminName: user.userName,
          adminEmail: user.emailId,
          adminPassword: password,
          instituteName: roleName === "super_admin" ? "ViaExam Platform" : instituteName,
          loginUrl,
          plan: roleName === "super_admin" ? "PLATFORM" : "PREMIUM",
        })
      : composeUserCredentials({
          userName: user.userName,
          email: user.emailId,
          phone: user.phoneNumber,
          password,
          role: roleName.charAt(0).toUpperCase() + roleName.slice(1),
          loginUrl,
          kind: "reset",
        });
  return queueEmail({
    kind: "password-reset",
    message,
    dedupeKey: `credentials-${user.userId}`,
    setPassword: { userId: user.userId, hash },
    notify: notifyOf(requestedBy, user),
  });
};

/**
 * Emails a user their login email and sign-in link, and leaves the password alone.
 * (The current password can't be sent: only its hash is stored.)
 */
const sendLoginDetails = async (user: any, requestedBy?: any): Promise<QueuedEmail> => {
  const { roleName, loginUrl } = await signInFor(user);
  return queueEmail({
    kind: "login-details",
    message: composeUserCredentials({
      userName: user.userName,
      email: user.emailId,
      phone: user.phoneNumber,
      password: null,
      role: roleName.charAt(0).toUpperCase() + roleName.slice(1),
      loginUrl,
      kind: "details",
    }),
    dedupeKey: `login-details-${user.userId}`,
    notify: notifyOf(requestedBy, user),
  });
};

/** The rule for passwords people choose: 8–64 characters, an uppercase and a lowercase letter, a digit. */
const STRONG_PASSWORD_MESSAGE = "Password must be 8–64 characters with an uppercase letter, a lowercase letter and a number.";
const isStrongPassword = (password: string) =>
  password.length >= 8 && password.length <= 64 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);

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

    const user = await UserModal.findOne({ where: { ...emailIs(cleanEmail), status: 1, isDeleted: false } });
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
    const user: any = admin?.instituteId
      ? await UserModal.findOne({
          where: { ...emailIs(cleanEmail), instituteId: admin.instituteId, isDeleted: false },
          include: [{ model: Role, as: "role" }],
        })
      : null;
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
      const sent = await sendLoginDetails(user, admin);
      if (sent.duplicate) return { error: true, statusCode: httpStatus.CONFLICT, message: `Login details are already on their way to ${user.emailId}.` };
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: `Login details are being sent to ${user.emailId}. Their password is unchanged.`,
        data: { email: user.emailId, mode: how },
      };
    }
    if (how === "manual" && !typed) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Enter the new password, or let one be generated." };
    }

    let nextPassword = Helper.generateTempPassword();
    if (how === "manual") {
      nextPassword = String(password).trim();
      if (!isStrongPassword(nextPassword)) {
        return { error: true, statusCode: httpStatus.BAD_REQUEST, message: STRONG_PASSWORD_MESSAGE };
      }
    }

    const sent = await issueCredentials(user, nextPassword, admin);
    if (sent.duplicate) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: `A new password for ${user.emailId} is already being emailed. Wait for that email before resetting again.`,
      };
    }
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `New login details are being sent to ${user.emailId}. The new password works as soon as the email goes out.`,
      data: { email: user.emailId, mode: how },
    };
  } catch (e: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Could not reset the password. Please try again." };
  }
};

// ─── Password reset by emailed code (OTP) ─────────────────────────────────────
// The code comes from crypto.randomInt and only its HMAC digest is stored (utils/dataProtection).
// A code allows MAX_WRONG_CODES wrong tries; each check claims its try before comparing, so
// parallel guesses can't get past the limit. A new code can be asked for once a minute.

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const MAX_WRONG_CODES = 5;

/** Reset rows of an address whatever its case (rows from before kept the case it was typed in). */
const resetsOf = (cleanEmail: string) => sqlWhere(fn("lower", col("email")), cleanEmail);

type CodeCheck = { ok: true; record: PasswordReset } | { ok: false; statusCode: number; message: string };

const checkCode = async (cleanEmail: string, otp: unknown): Promise<CodeCheck> => {
  const record = await PasswordReset.findOne({
    where: { [Op.and]: [resetsOf(cleanEmail), { isUsed: false }] },
    order: [["createdAt", "DESC"]],
  });
  if (!record) return { ok: false, statusCode: httpStatus.BAD_REQUEST, message: "Invalid OTP. Please check and try again." };
  if (new Date() > record.expiresAt) return { ok: false, statusCode: httpStatus.BAD_REQUEST, message: "OTP has expired. Please request a new one." };

  const claimed = await sequelize.query<{ attempts: number }>(
    `UPDATE "viaexam_password_resets" SET "attempts" = "attempts" + 1 WHERE "id" = :id AND "isUsed" = false AND "attempts" < :max RETURNING "attempts"`,
    { replacements: { id: record.id, max: MAX_WRONG_CODES }, type: QueryTypes.SELECT }
  );
  if (!claimed.length) {
    await record.update({ isUsed: true });
    return { ok: false, statusCode: httpStatus.TOO_MANY_REQUESTS, message: "Too many wrong codes. Please request a new OTP." };
  }
  if (!verifySecret(String(otp ?? "").trim(), record.otp, "otp")) {
    if (claimed[0].attempts >= MAX_WRONG_CODES) {
      await record.update({ isUsed: true });
      return { ok: false, statusCode: httpStatus.TOO_MANY_REQUESTS, message: "Too many wrong codes. Please request a new OTP." };
    }
    return { ok: false, statusCode: httpStatus.BAD_REQUEST, message: "Invalid OTP. Please check and try again." };
  }
  // The right code: this check doesn't count against the wrong ones (verify, then reset, use it twice).
  await sequelize.query(`UPDATE "viaexam_password_resets" SET "attempts" = GREATEST("attempts" - 1, 0) WHERE "id" = :id`, {
    replacements: { id: record.id },
  });
  return { ok: true, record };
};

// ─── STEP 1: Send OTP ─────────────────────────────────────────────────────────
const forgotPassword = async (email: string): Promise<any> => {
  try {
    const cleanEmail = String(email ?? "").trim().toLowerCase();

    // 1. Check user exists
    const user = await UserModal.findOne({
      where: { ...emailIs(cleanEmail), status: 1 },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "No account found with this email.",
      };
    }

    // 2. One code a minute per address (the page's "Resend" waits a minute too)
    const latest = await PasswordReset.findOne({ where: resetsOf(cleanEmail), order: [["createdAt", "DESC"]], attributes: ["createdAt"] });
    const waitMs = latest ? OTP_RESEND_MS - (Date.now() - new Date(latest.createdAt).getTime()) : 0;
    if (waitMs > 0) {
      return {
        error: true,
        statusCode: httpStatus.TOO_MANY_REQUESTS,
        message: `A code was sent less than a minute ago. Check your inbox (and spam), or ask for a new one in ${Math.ceil(waitMs / 1000)} seconds.`,
      };
    }

    // 3. Get user role for personalized email
    const roleName = await getRoleName(user.roleId);

    // 4. A 6-digit code from the cryptographic generator, valid for 10 minutes
    const otp = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // 5. Older codes stop working; their emails are dropped if they haven't gone out yet
    const older = await PasswordReset.findAll({ where: { [Op.and]: [resetsOf(cleanEmail), { isUsed: false }] }, attributes: ["id"] });
    if (older.length) await PasswordReset.update({ isUsed: true }, { where: { id: older.map((r) => r.id) } });
    older.forEach((r) => void cancelQueuedEmail(`otp-${r.id}`));

    // 6. Save only the code's digest
    const record = await PasswordReset.create({ email: cleanEmail, otp: digestSecret(otp, "otp"), expiresAt });

    // 7. Queue the role-specific email: ahead of bulk mail, retried for a few minutes, never sent after the code expires
    await queueEmail({
      kind: "otp",
      message: composeOtpEmail({ toEmail: user.emailId, userName: user.userName, otp, role: roleName }),
      jobId: `otp-${record.id}`,
      notAfter: expiresAt,
      attempts: 5,
      retryMs: 10_000,
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
    const cleanEmail = String(email ?? "").trim().toLowerCase();

    // 1. Check the code (counts against the wrong-code limit when wrong)
    const check = await checkCode(cleanEmail, otp);
    if (!check.ok) return { error: true, statusCode: check.statusCode, message: check.message };

    // 2. Check if user still exists and is active
    const user = await UserModal.findOne({
      where: { ...emailIs(cleanEmail), status: 1 },
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
    const cleanEmail = String(email ?? "").trim().toLowerCase();

    // 1. The new password must be strong (before the code is checked, so a weak one costs no try)
    if (!isStrongPassword(String(newPassword ?? ""))) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: STRONG_PASSWORD_MESSAGE };
    }

    // 2. Check the code
    const check = await checkCode(cleanEmail, otp);
    if (!check.ok) return { error: true, statusCode: check.statusCode, message: check.message };

    // 3. Find user
    const user = await UserModal.findOne({
      where: { ...emailIs(cleanEmail), status: 1 },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "User not found.",
      };
    }

    // 4. Hash + update password; sessions signed in with the old one end
    const encrypted = await EncryptPassword.encryptPassword(String(newPassword));
    await user.update({ password: encrypted, refreshToken: null });

    // 5. Mark OTP as used
    await check.record.update({ isUsed: true });

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