import httpStatus from "http-status";
import { Response } from "express";
import DashboardService from "../services/dashboard.service";

const getInstituteStats = async (
  req: any,
  res: Response
): Promise<any> => {
  try {
    const result = await DashboardService.getInstituteStats();

    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getStudentStats = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await DashboardService.getStudentStats();

    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getExamStats = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await DashboardService.getExamStats();

    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getEvaluatedAnswersheetStats = async (
  req: any,
  res: Response
): Promise<any> => {
  try {
    const result = await DashboardService.getEvaluatedAnswersheetStats();

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
  getInstituteStats,
  getStudentStats,
  getExamStats,
  getEvaluatedAnswersheetStats,
};