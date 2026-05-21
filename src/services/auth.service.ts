import httpStatus from "http-status";
import UserModal from "../modals/User.modal";
import PasswordReset from "../modals/PasswordReset.modal";
import EncryptPassword from "../utils/encryption"
import { sendOtpEmail } from "../utils/mailHelper" // your existing mailer

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

    // 2. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // 3. Expire in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // 4. Invalidate any previous unused OTPs for this email
    await PasswordReset.update(
      { isUsed: true },
      { where: { email, isUsed: false } }
    );

    // 5. Save new OTP
    await PasswordReset.create({ email, otp, expiresAt });

    // 6. Send email
    await sendOtpEmail({
      toEmail: email,
      userName: user.userName,
      otp,
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

// ─── STEP 2: Verify OTP + Reset Password ─────────────────────────────────────
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

export default { forgotPassword, resetPassword };