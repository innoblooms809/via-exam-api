import httpStatus from "http-status";
import { Request, Response } from "express";
import svgCaptcha from "svg-captcha"; // same as your boilerplate
import tokenService from "../../services/token.service"; // reuse your existing tokenService
import Service from "../../services/auth/user.service";
import { sendEmailToNewUser } from "../../utils/mailHelper"; // reuse your mail helper

interface IGetUserInfoRequest extends Request {
  session: any; // same interface as your boilerplate
}

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

    return res.status(httpStatus.OK).send({
      error: false,
      statusCode: httpStatus.OK,
      message: "User logged in successfully",
      token,
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
  createViaExamUser,
  logoutViaExamUser,
  getViaExamProfile,
};
