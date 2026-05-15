import httpStatus from "http-status";
import UserModal from "../../modals/User.modal";
import Role from "../../modals/Role.modal";
import EncryptPassword from "../../utils/encryption"; // reuse your existing utility
import RegHelper from "../../utils/helper";           // reuse your existing utility
import exclude from "../../utils/exclude";            // reuse your existing utility

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 30;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetch ViaExam user by emailId — mirrors your getUserByEmail() pattern
 */
const getViaExamUserByEmail = async (emailId: string): Promise<any> => {
  return UserModal.findOne({
    include: [
      {
        model: Role,
        as: "role",
      },
    ],
    where: { emailId: emailId },
  });
};

/**
 * Fetch ViaExam user by phoneNumber — mirrors your getUserByMobile() pattern
 */
const getViaExamUserByMobile = async (phoneNumber: string): Promise<any> => {
  return UserModal.findOne({
    include: [
      {
        model: Role,
        as: "role",
      },
    ],
    where: { phoneNumber: phoneNumber },
  });
};

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Create Super Admin user
 * Called once during initial setup — mirrors your userCreate() pattern
 */
const viaExamUserCreate = async (req: any): Promise<any> => {
  try {
    const conflictFields = [];
    const existUserEmail = await getViaExamUserByEmail(req.body.emailId);
    const existUserMobile = await getViaExamUserByMobile(req.body.phoneNumber);

    if (existUserEmail) conflictFields.push("email");
    if (existUserMobile) conflictFields.push("mobile");

    if (conflictFields.length > 0) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        data: {},
        message: `This ${conflictFields.join(" & ")} is already registered.`,
      };
    }

    // Reuse your existing helpers
    const password = await RegHelper.generatePassword();
    const encryptedPassword = await EncryptPassword.encryptPassword(password);
    const userId = await RegHelper.generateUserId();

    req.body.password = encryptedPassword;
    req.body.userId = userId;

    const newUser = await UserModal.create(req.body);
    const { password: _, ...userResponse } = newUser.toJSON();

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      data: userResponse,
      password, // returned so caller can email the plain password
      message: "ViaExam user created successfully.",
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

/**
 * ViaExam login — mirrors your userLogin() pattern exactly.
 * type 1 = email login, type 2 = mobile login
 * Adds: account lockout, status checks
 */
const viaExamUserLogin = async (emailId: string, password: string) => {
  try {
    const user = await getViaExamUserByEmail(emailId);

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Invalid credentials.",
      };
    }

    // status check
    if (user.status === 0) {
      return {
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message: "Your account is inactive.",
      };
    }

    if (user.status === 2) {
      return {
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message: "Account suspended.",
      };
    }

    // lock check (SAFE VERSION)
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      return {
        error: true,
        statusCode: httpStatus.TOO_MANY_REQUESTS,
        message: "Account is locked.",
      };
    }

    const isMatch = await EncryptPassword.isPasswordMatch(
      password,
      user.password
    );

    if (!isMatch) {
      const attempts = (user.loginAttempts || 0) + 1;

      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        await UserModal.update(
          {
            loginAttempts: attempts,
            lockedUntil: new Date(Date.now() + LOCK_DURATION_MINUTES * 60000),
          },
          { where: { userId: user.userId } }
        );
      } else {
        await UserModal.update(
          { loginAttempts: attempts },
          { where: { userId: user.userId } }
        );
      }

      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Invalid credentials.",
      };
    }

    await UserModal.update(
      {
        loginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
      { where: { userId: user.userId } }
    );

    const userResponse = exclude(user.toJSON(), ["password", "refreshToken"]);

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: { user: userResponse },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      message: e.message,
    };
  }
};

/**
 * Logout — store/clear refresh token (mirrors your token invalidation pattern)
 */
const viaExamUserLogout = async (userId: string): Promise<any> => {
  try {
    await UserModal.update(
      { refreshToken: null },
      { where: { userId } }
    );
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: {},
      message: "Logged out successfully.",
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

/**
 * Get ViaExam user profile by userId
 */
const viaExamGetProfile = async (userId: string): Promise<any> => {
  try {
    const user = await UserModal.findOne({
      include: [{ model: Role, as: "role" }],
      where: { userId },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        data: {},
        message: "User not found.",
      };
    }

    const userResponse = exclude(user.toJSON(), ["password", "refreshToken"]);
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: userResponse,
      message: "Profile fetched successfully.",
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: e.message,
    };
  }
};

export default {
  viaExamUserCreate,
  viaExamUserLogin,
  viaExamUserLogout,
  viaExamGetProfile,
  getViaExamUserByEmail, // exported so controller/token service can use it
};
