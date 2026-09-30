import { Response } from "express";
import httpStatus from "http-status";
import TeacherdashboardService from "../services/teacherdashboard.service";

const getTeacherDashboardOverview = async (req: any, res: Response): Promise<any> => {
  try {
    const teacherId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;

    const result = await TeacherdashboardService.getTeacherDashboardOverview(teacherId, instituteId);

    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getUpcomingExams = async (req: any, res: Response): Promise<any> => {
  try {
    const teacherId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await TeacherdashboardService.getUpcomingExams(teacherId, instituteId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getExamActivity = async (req: any, res: Response): Promise<any> => {
  try {
    const teacherId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await TeacherdashboardService.getExamActivity(teacherId, instituteId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getActivityOverview = async (req: any, res: Response): Promise<any> => {
  try {
    const teacherId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await TeacherdashboardService.getActivityOverview(teacherId, instituteId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getUpcomingWork = async (req: any, res: Response): Promise<any> => {
  try {
    const teacherId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await TeacherdashboardService.getUpcomingWork(teacherId, instituteId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getEvaluationStatus = async (req: any, res: Response): Promise<any> => {
  try {
    const teacherId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await TeacherdashboardService.getEvaluationStatus(teacherId, instituteId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getSubjectWorkload = async (req: any, res: Response): Promise<any> => {
  try {
    const teacherId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await TeacherdashboardService.getSubjectWorkload(teacherId, instituteId);
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
    const teacherId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await TeacherdashboardService.getRecentActivity(teacherId, instituteId);
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
  getTeacherDashboardOverview,
  getUpcomingExams,
  getExamActivity,
  getActivityOverview,
  getUpcomingWork,
  getEvaluationStatus,
  getSubjectWorkload,
  getRecentActivity,
};
