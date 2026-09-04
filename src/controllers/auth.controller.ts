import { Request, Response } from "express";
import httpStatus from "http-status";
import AuthService from "../services/auth.service";

const forgotPassword = async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await AuthService.forgotPassword(req.body.email);
    return res.status(result.statusCode).send(result);
  } catch {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const verifyOtp = async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, otp } = req.body;
    const result = await AuthService.verifyOtp(email, otp);
    return res.status(result.statusCode).send(result);
  } catch {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const resetPassword = async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, otp, newPassword } = req.body;
    const result = await AuthService.resetPassword(email, otp, newPassword);
    return res.status(result.statusCode).send(result);
  } catch {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const resendCredentials = async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await AuthService.resendCredentials(req.body.email);
    return res.status(result.statusCode).send(result);
  } catch {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

export default { forgotPassword, verifyOtp, resetPassword, resendCredentials };