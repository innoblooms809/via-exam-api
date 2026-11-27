import httpStatus from "http-status";
import { Request, Response } from "express";
import svgCaptcha from "svg-captcha"; // same as your boilerplate
import Service from "../../services/auth/user.service";
import { queueUserCredentials } from "../../utils/mailHelper"; // queued; retried while SMTP is down
import config from "../../config/config";
import logger from "../../config/logger";
import { resolveRequestAuthRole } from "../../middlewares/auth";
import {
  clearAuthCookies,
  endAllSessions,
  endReplacedSession,
  endSession,
  refreshSession,
  setAuthCookies,
  startSession,
} from "../../services/auth/session.service";

interface IGetUserInfoRequest extends Request {
  session?: any; // Optional: express-session middleware is disabled (captcha not in use)
}

// ─── GET CAPTCHA ──────────────────────────────────────────────────────────────
/**
 * GET /api/viaexam/auth/captcha
 * Identical pattern to your getCaptcha()
 */
const getCaptcha = async (req: IGetUserInfoRequest, res: any) => {
  const captcha = svgCaptcha.create();
  // req.session.captcha = captcha.text; // Commented out: session middleware disabled
  res.set("Content-Type", "image/svg+xml");
  res.send(captcha.data);
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
/**
 * POST /v1/user/login   Body: { slug, emailId, password }
 *
 * Starts a session (services/auth/session.service). Its tokens go into httpOnly cookies, where the
 * page's JavaScript can't read them; the response body carries the profile only.
 */
const loginViaExamUser = async (
  req: IGetUserInfoRequest,
  res: Response,
): Promise<any> => {
  try {
    const { slug, emailId, password } = req.body;

    const result = await Service.viaExamUserLogin(slug, emailId, password);
    if (result.error || !result.data) {
      return res.status(result.statusCode).send(result);
    }

    const user: any = result.data.user;
    const role: string = user.role?.role || "";

    // This browser's earlier session for the role ends: its cookies are replaced now.
    await endReplacedSession(req, role);
    setAuthCookies(res, role, await startSession(user.userId, req));

    return res.status(httpStatus.OK).send({
      error: false,
      statusCode: httpStatus.OK,
      message: "User logged in successfully",
      data: {
        userName: user.userName,
        userId: user.userId,
        emailId: user.emailId,
        phoneNumber: user.phoneNumber,
        roleId: user.roleId,
        role: role.toLowerCase() || null,
        instituteId: user.instituteId,
        status: user.status,
      },
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

// ─── REFRESH ──────────────────────────────────────────────────────────────────
/**
 * POST /v1/user/refresh-token   No body: the refresh token is the httpOnly cookie the browser sends
 * only to this path. New cookies on success; the body never carries a token.
 */
const refreshAccessToken = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const role = resolveRequestAuthRole(req);
    const result = await refreshSession(req, role);

    if (!result.ok) {
      if (role) clearAuthCookies(res, role);
      const { statusCode, message } = result.problem ?? {
        statusCode: httpStatus.UNAUTHORIZED,
        message:
          result.reason === "reused"
            ? "For your security this session was signed out. Please sign in again."
            : "Your session has ended. Please sign in again.",
      };
      return res.status(statusCode).json({ error: true, statusCode, message });
    }

    setAuthCookies(res, result.user.role?.role, result);
    return res.status(httpStatus.OK).json({
      error: false,
      statusCode: httpStatus.OK,
      message: "Session refreshed.",
      data: {},
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

      void queueUserCredentials({
        userName:
          req.body.userName ||
          `${req.body.firstName || ""} ${req.body.lastName || ""}`.trim(),
        email: req.body.emailId || req.body.email,
        phone: req.body.phoneNumber || "",
        password: result.password,
        role: req.body.role || "User",
        loginUrl,
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
 * POST /v1/user/logout   Ends this session and clears its cookies; the user's other sessions
 * (another browser, another role in this one) stay signed in.
 */
const logoutViaExamUser = async (req: any, res: Response): Promise<any> => {
  try {
    clearAuthCookies(res, req.viaExamUser?.role?.role);
    if (req.authSessionId) await endSession(req.authSessionId, "logout");
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

/** POST /v1/user/logout-all   Ends every session of this user, this one included. */
const logoutEverywhere = async (req: any, res: Response): Promise<any> => {
  try {
    const sessions = await endAllSessions(req.viaExamUser.userId, "logout-all");
    clearAuthCookies(res, req.viaExamUser?.role?.role);
    await Service.viaExamUserLogout(req.viaExamUser.userId);
    return res.status(httpStatus.OK).send({
      error: false,
      statusCode: httpStatus.OK,
      message: "Signed out on every device.",
      data: { sessions },
    });
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

/**
 * PUT /api/viaexam/auth/me
 * Protected — updates profile for current user
 */
const updateViaExamProfile = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Service.viaExamUpdateProfile(
      req.viaExamUser.userId,
      req.body,
      req.files
    );
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
  logoutEverywhere,
  getViaExamProfile,
  updateViaExamProfile,
};
