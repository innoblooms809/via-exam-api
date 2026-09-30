import { Response } from "express";
import httpStatus from "http-status";
import AdmindashboardService from "../services/Admindashboard.service";

const missingInstitute = (res: Response) =>
  res.status(httpStatus.BAD_REQUEST).json({
    error: true,
    statusCode: httpStatus.BAD_REQUEST,
    message: "Institute not found for this user.",
  });

const handleResult = async (
  req: any,
  res: Response,
  runner: (instituteId: string) => Promise<any>
): Promise<any> => {
  try {
    const instituteId = req.viaExamUser?.instituteId;
    if (!instituteId) {
      return missingInstitute(res);
    }

    const result = await runner(instituteId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getOverview = async (req: any, res: Response): Promise<any> => {
  return handleResult(req, res, AdmindashboardService.getOverview);
};

const getTeacherAnalytics = async (req: any, res: Response): Promise<any> => {
  return handleResult(req, res, AdmindashboardService.getTeacherAnalytics);
};

const getScannerAnalytics = async (req: any, res: Response): Promise<any> => {
  return handleResult(req, res, AdmindashboardService.getScannerAnalytics);
};

const getStudentAnalytics = async (req: any, res: Response): Promise<any> => {
  return handleResult(req, res, AdmindashboardService.getStudentAnalytics);
};

const getSuperAdminAnalytics = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await AdmindashboardService.getSuperAdminAnalytics();
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

export default {
  getOverview,
  getTeacherAnalytics,
  getScannerAnalytics,
  getStudentAnalytics,
  getSuperAdminAnalytics,
};
