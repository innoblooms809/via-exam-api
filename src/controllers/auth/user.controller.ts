import httpStatus from "http-status";
import { Request, Response } from "express";
import svgCaptcha from "svg-captcha"; // same as your boilerplate
import jwt from "jsonwebtoken";
import tokenService from "../../services/token.service"; // reuse your existing tokenService
import Service from "../../services/auth/user.service";
import { sendEmailToNewUser } from "../../utils/mailHelper"; // reuse your mail helper
import config from "../../config/config";
import UserModal from "../../modals/User.modal";

interface IGetUserInfoRequest extends Request {
  session: any; // same interface as your boilerplate
}

const getCookieValue = (req: Request, name: string): string | undefined => {
  const cookies = (req as any).cookies;
  if (cookies?.[name]) {
    return cookies[name];
  }

  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }

  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
};

// ─── GET CAPTCHA ──────────────────────────────────────────────────────────────
/**
 * GET /api/viaexam/auth/captcha
 * Identical pattern to your getCaptcha()
 */
const getCaptcha = async (req: IGetUserInfoRequest, res: any) => {
  const captcha = svgCaptcha.create();
  req.session.captcha = captcha.text;
  res.set("Content-Type", "image/svg+xml");
  res.send(captcha.data);
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
/**
 * POST /api/viaexam/auth/login
 *
 * Body: { emailId, mobileNo, type, password, captcha }
 * type 1 = email, type 2 = mobile  ← matches your existing pattern
 *
 * Reuses: your tokenService.generateUserAuthTokens()
 */
const loginViaExamUser = async (
  req: IGetUserInfoRequest,
  res: Response,
): Promise<any> => {
  try {
    const { emailId, password } = req.body;

    // CAPTCHA check — identical to your boilerplate
    // if (captcha !== req.session.captcha) {
    //   return res.status(400).json({ message: "Invalid CAPTCHA" });
    // }

    const result = await Service.viaExamUserLogin(emailId, password);

    if (result.error) {
      return res.status(result.statusCode).send(result);
    }

    // Reuse your existing tokenService — same call signature as your boilerplate
    if (result.error || !result.data) {
      return res.status(result.statusCode).send(result);
    }
    const token = await tokenService.generateUserAuthTokens(result.data.user);

    await UserModal.update(
      { refreshToken: token.refresh.token },
      { where: { userId: result.data.user.userId } }
    );

    // Set tokens as httpOnly cookies
    res.cookie("accessToken", token.access.token, {
      httpOnly: true,
      secure: false,
      // secure: process.env.NODE_ENV === "production",
      maxAge: config.jwt.accessExpirationMinutes * 60 * 1000, // Convert minutes to milliseconds
      sameSite: "lax",
    });

    res.cookie("refreshToken", token.refresh.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: config.jwt.refreshExpirationDays * 24 * 60 * 60 * 1000,
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

    return res.status(httpStatus.OK).send({
      error: false,
      statusCode: httpStatus.OK,
      message: "User logged in successfully",
      data: userData
    });
  } catch (error) {
    console.error(error);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: "Internal Server Error",
    });
  }
};

const refreshAccessToken = async (req: Request, res: Response): Promise<any> => {
  try {
    const refreshToken = getCookieValue(req, "refreshToken");

    if (!refreshToken) {
      return res.status(httpStatus.BAD_REQUEST).json({
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Refresh token missing",
      });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.secret);
    } catch (err: any) {
      console.error("Invalid refresh token:", err.message);
      return res.status(httpStatus.FORBIDDEN).json({
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Invalid or expired refresh token",
      });
    }

    const userId =
      typeof decoded.sub === "object"
        ? decoded.sub?.userId
        : decoded.sub ?? decoded.userId;

    if (!userId) {
      return res.status(httpStatus.FORBIDDEN).json({
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Invalid refresh token payload",
      });
    }

    const user = await UserModal.findOne({ where: { userId } });

    if (!user) {
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "User not found",
      });
    }

    if (user.refreshToken !== refreshToken) {
      return res.status(httpStatus.FORBIDDEN).json({
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Refresh token does not match",
      });
    }

    const token = await tokenService.generateUserAuthTokens(user);

    await UserModal.update(
      { refreshToken: token.refresh.token },
      { where: { userId: user.userId } }
    );

    res.cookie("accessToken", token.access.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: config.jwt.accessExpirationMinutes * 60 * 1000,
      sameSite: "lax",
    });

    res.cookie("refreshToken", token.refresh.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: config.jwt.refreshExpirationDays * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });

    return res.status(httpStatus.OK).json({
      error: false,
      statusCode: httpStatus.OK,
      message: "Access token refreshed successfully",
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
    });
  }
};

// ─── CREATE USER (Super Admin seeding / admin panel) ─────────────────────────
/**
 * POST /api/viaexam/auth/create-user
 * Mirrors your createUser() — also sends welcome email
 */
const createViaExamUser = async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await Service.viaExamUserCreate(req);

    if (!result.error) {
      // Reuse your existing mail helper
      await sendEmailToNewUser({ ...req.body, password: result.password });
    }

    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: "Internal Server Error",
    });
  }
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
/**
 * POST /api/viaexam/auth/logout
 * Protected by authenticate middleware — reads userId from req.viaExamUser
 */
const logoutViaExamUser = async (req: any, res: Response): Promise<any> => {
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

    const result = await Service.viaExamUserLogout(req.viaExamUser.userId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: "Internal Server Error",
    });
  }
};

// ─── GET PROFILE ──────────────────────────────────────────────────────────────
/**
 * GET /api/viaexam/auth/me
 * Protected — reads userId from req.viaExamUser (set by authenticate middleware)
 */
const getViaExamProfile = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Service.viaExamGetProfile(req.viaExamUser.userId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: "Internal Server Error",
    });
  }
};

export default {
  getCaptcha,
  loginViaExamUser,
  refreshAccessToken,
  createViaExamUser,
  logoutViaExamUser,
  getViaExamProfile,
};
