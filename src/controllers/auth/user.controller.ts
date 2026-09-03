import httpStatus from "http-status";
import { Request, Response } from "express";
import svgCaptcha from "svg-captcha"; // same as your boilerplate
import jwt from "jsonwebtoken";
import tokenService from "../../services/token.service"; // reuse your existing tokenService
import Service from "../../services/auth/user.service";
import { sendUserCredentials } from "../../utils/mailHelper"; // reuse your mail helper
import config from "../../config/config";
import UserModal from "../../modals/User.modal";
import UserPresenceSession from "../../modals/UserPresenceSession.modal";
import logger from "../../config/logger";
import Role from "../../modals/Role.modal";
import { resolveRequestAuthRole } from "../../middlewares/auth";

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

const getRoleCookieNames = (roleStr: string) => {
  const cleanRole = String(roleStr || "").toUpperCase().replace(/[\s_-]+/g, "");
  if (cleanRole === "SUPERADMIN") {
    return { access: "superAdminToken", refresh: "superAdminRefreshToken" };
  }
  if (cleanRole === "ADMIN") {
    return { access: "adminToken", refresh: "adminRefreshToken" };
  }
  if (cleanRole === "TEACHER") {
    return { access: "teacherToken", refresh: "teacherRefreshToken" };
  }
  if (cleanRole === "STUDENT") {
    return { access: "studentToken", refresh: "studentRefreshToken" };
  }
  if (cleanRole === "SCANNER") {
    return { access: "scannerToken", refresh: "scannerRefreshToken" };
  }
  return { access: "accessToken", refresh: "refreshToken" };
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
    const { slug, emailId, password } = req.body;

    // CAPTCHA check — identical to your boilerplate
    // if (captcha !== req.session.captcha) {
    //   return res.status(400).json({ message: "Invalid CAPTCHA" });
    // }

    const result = await Service.viaExamUserLogin(
      slug,
      emailId,
      password
    );

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
      { where: { userId: result.data.user.userId } },
    );

    const cookieNames = getRoleCookieNames((result.data.user as any).role?.role || "");

    // Set tokens as httpOnly cookies (role-scoped to avoid session collisions)
    res.cookie(cookieNames.access, token.access.token, {
      httpOnly: true,
      secure: false,
      // secure: process.env.NODE_ENV === "production",
      maxAge: config.jwt.accessExpirationMinutes * 60 * 1000, // Convert minutes to milliseconds
      sameSite: "lax",
    });

    res.cookie(cookieNames.refresh, token.refresh.token, {
      httpOnly: true,
      secure: false,
      maxAge: config.jwt.refreshExpirationDays * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });

    // Send user data and access tokens to frontend
    const userData = {
      userName: result.data.user.userName,
      userId: result.data.user.userId,
      emailId: result.data.user.emailId,
      phoneNumber: result.data.user.phoneNumber,
      roleId: result.data.user.roleId,
      role: (result.data.user as any).role?.role?.toLowerCase() || null,
      instituteId: result.data.user.instituteId,
      status: result.data.user.status,
      token: token.access.token,
      accessToken: token.access.token,
      refreshToken: token.refresh.token,
    };

    return res.status(httpStatus.OK).send({
      error: false,
      statusCode: httpStatus.OK,
      message: "User logged in successfully",
      data: userData,
    });
  } catch (error) {
    logger.error(`Login error: ${error}`);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: "Internal Server Error",
    });
  }
};

const refreshAccessToken = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const superAdminRefresh = getCookieValue(req, "superAdminRefreshToken");
    const adminRefresh = getCookieValue(req, "adminRefreshToken");
    const teacherRefresh = getCookieValue(req, "teacherRefreshToken");
    const studentRefresh = getCookieValue(req, "studentRefreshToken");
    const scannerRefresh = getCookieValue(req, "scannerRefreshToken");
    const defaultRefresh = getCookieValue(req, "refreshToken");
    const bodyRefresh =
      typeof req.body?.refreshToken === "string" ? req.body.refreshToken : undefined;
    const authRole = resolveRequestAuthRole(req);

    const roleRefreshByKey: Record<string, string | undefined> = {
      superadmin: superAdminRefresh,
      admin: adminRefresh,
      teacher: teacherRefresh,
      student: studentRefresh,
      scanner: scannerRefresh,
    };

    const candidates = [
      bodyRefresh,
      authRole ? roleRefreshByKey[authRole] : undefined,
      !authRole ? adminRefresh : undefined,
      !authRole ? teacherRefresh : undefined,
      !authRole ? superAdminRefresh : undefined,
      !authRole ? studentRefresh : undefined,
      !authRole ? scannerRefresh : undefined,
      defaultRefresh,
    ].filter((value, index, list): value is string => !!value && list.indexOf(value) === index);

    if (!candidates.length) {
      return res.status(httpStatus.BAD_REQUEST).json({
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Refresh token missing",
      });
    }

    let refreshToken: string | undefined;
    let decoded: any;
    for (const candidate of candidates) {
      try {
        decoded = jwt.verify(candidate, config.jwt.secret);
        refreshToken = candidate;
        break;
      } catch {
        // try next candidate (stale tab token vs rotated cookie)
      }
    }

    if (!refreshToken || !decoded) {
      logger.error("Invalid refresh token: no usable candidate");
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

    const user = await UserModal.findOne({
      where: { userId },
      include: [{ model: Role, as: "role" }],
    });

    if (!user) {
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "User not found",
      });
    }

    const matchingStored = candidates.find((candidate) => candidate === user.refreshToken);
    if (matchingStored) {
      refreshToken = matchingStored;
    }

    const isSameUser =
      (decoded as any).sub?.userId === user.userId ||
      (decoded as any).sub === user.userId;

    if (!isSameUser || !user.refreshToken || user.refreshToken !== refreshToken) {
      return res.status(httpStatus.FORBIDDEN).json({
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Invalid or revoked refresh token",
      });
    }

    const token = await tokenService.generateUserAuthTokens(user);

    await UserModal.update(
      { refreshToken: token.refresh.token },
      { where: { userId: user.userId } },
    );

    const cookieNames = getRoleCookieNames((user as any).role?.role || "");

    res.cookie(cookieNames.access, token.access.token, {
      httpOnly: true,
      secure: false,
      maxAge: config.jwt.accessExpirationMinutes * 60 * 1000,
      sameSite: "lax",
    });

    res.cookie(cookieNames.refresh, token.refresh.token, {
      httpOnly: true,
      secure: false,
      maxAge: config.jwt.refreshExpirationDays * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });

    return res.status(httpStatus.OK).json({
      error: false,
      statusCode: httpStatus.OK,
      message: "Access token refreshed successfully",
      data: {
        token: token.access.token,
        accessToken: token.access.token,
        refreshToken: token.refresh.token,
      },
    });
  } catch (error) {
    logger.error(`Refresh token error: ${error}`);
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
const createViaExamUser = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Service.viaExamUserCreate(req);

    if (!result.error) {
      const slug = req.viaExamUser?.institute?.slug;
      const loginUrl = slug
        ? `${config.frontendUrl}/${slug}/auth/signin`
        : `${config.frontendUrl}/auth/signin`;

      sendUserCredentials({
        userName:
          req.body.userName ||
          `${req.body.firstName || ""} ${req.body.lastName || ""}`.trim(),
        email: req.body.emailId || req.body.email,
        phone: req.body.phoneNumber || "",
        password: result.password,
        role: req.body.role || "User",
        loginUrl,
      }).catch((err) => {
        logger.error(`Background user email dispatch failed: ${err}`);
      });
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
    // Clear only this user's role cookies so other tabs stay logged in
    const cookieOpts = { httpOnly: true, secure: false, sameSite: "lax" as const };
    const cookieNames = getRoleCookieNames(req.viaExamUser?.role?.role || "");
    res.clearCookie(cookieNames.access, cookieOpts);
    res.clearCookie(cookieNames.refresh, cookieOpts);
    if (cookieNames.access !== "accessToken") {
      res.clearCookie("accessToken", cookieOpts);
      res.clearCookie("refreshToken", cookieOpts);
    }

    if (req.viaExamUser?.userId) {
      UserPresenceSession.update(
        { presenceStatus: "OFFLINE", currentActivity: "Logged Out", lastLogoutAt: new Date() },
        { where: { userId: req.viaExamUser.userId } }
      ).catch(() => {});
    }

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
