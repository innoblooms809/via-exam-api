import { Response } from "express";
import httpStatus from "http-status";
import ScannerdashboardService from "../services/scannerdashboard.service";

const getKpis = async (req: any, res: Response): Promise<any> => {
  try {
    const instituteId = req.viaExamUser.instituteId;
    const result = await ScannerdashboardService.getKpis(instituteId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getHourlyActivity = async (req: any, res: Response): Promise<any> => {
  try {
    const instituteId = req.viaExamUser.instituteId;
    const result = await ScannerdashboardService.getHourlyActivity(instituteId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getStatusDistribution = async (req: any, res: Response): Promise<any> => {
  try {
    const instituteId = req.viaExamUser.instituteId;
    const result = await ScannerdashboardService.getStatusDistribution(instituteId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getRecentScans = async (req: any, res: Response): Promise<any> => {
  try {
    const instituteId = req.viaExamUser.instituteId;
    const result = await ScannerdashboardService.getRecentScans(instituteId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getExamProgress = async (req: any, res: Response): Promise<any> => {
  try {
    const instituteId = req.viaExamUser.instituteId;
    const result = await ScannerdashboardService.getExamProgress(instituteId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getPendingScans = async (req: any, res: Response): Promise<any> => {
  try {
    const instituteId = req.viaExamUser.instituteId;
    const result = await ScannerdashboardService.getPendingScans(instituteId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getRecentActivity = async (req: any, res: Response): Promise<any> => {
  try {
    const instituteId = req.viaExamUser.instituteId;
    const result = await ScannerdashboardService.getRecentActivity(instituteId);
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
  getKpis,
  getHourlyActivity,
  getStatusDistribution,
  getRecentScans,
  getExamProgress,
  getPendingScans,
  getRecentActivity,
};
