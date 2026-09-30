import { Request, Response } from "express";
import httpStatus from "http-status";
import StudentdashboardService from "../services/studentdashboard.service";

const getStudentDashboardOverview = async (req: any, res: Response): Promise<any> => {
  try {
    const studentId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;

    const result = await StudentdashboardService.getStudentDashboardOverview(
      studentId,
      instituteId
    );

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
    const studentId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await StudentdashboardService.getUpcomingExams(studentId, instituteId, req.query);
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
    const studentId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await StudentdashboardService.getExamProgress(studentId, instituteId, req.query);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getPerformanceOverview = async (req: any, res: Response): Promise<any> => {
  try {
    const studentId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await StudentdashboardService.getPerformanceOverview(studentId, instituteId, req.query);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getSubjectComparison = async (req: any, res: Response): Promise<any> => {
  try {
    const studentId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await StudentdashboardService.getSubjectComparison(studentId, instituteId, req.query);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getLatestResults = async (req: any, res: Response): Promise<any> => {
  try {
    const studentId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await StudentdashboardService.getLatestResults(studentId, instituteId, req.query);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getSubjectPerformance = async (req: any, res: Response): Promise<any> => {
  try {
    const studentId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await StudentdashboardService.getSubjectPerformance(studentId, instituteId);
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
    const studentId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await StudentdashboardService.getRecentActivity(studentId, instituteId, req.query);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getRecheckRequests = async (req: any, res: Response): Promise<any> => {
  try {
    const studentId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await StudentdashboardService.getRecheckRequests(studentId, instituteId, req.query);
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
  getStudentDashboardOverview,
  getUpcomingExams,
  getExamProgress,
  getPerformanceOverview,
  getSubjectComparison,
  getLatestResults,
  getSubjectPerformance,
  getRecentActivity,
  getRecheckRequests,
};
