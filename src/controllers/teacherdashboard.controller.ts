import { Request, Response } from "express";
import httpStatus from "http-status";
import TeacherdashboardService from "../services/teacherdashboard.service";

const getTeacherDashboardOverview = async (req: any, res: Response): Promise<any> => {
  try {
    const teacherId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;

    const result = await TeacherdashboardService.getTeacherDashboardOverview(
      teacherId,
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

export default {
  getTeacherDashboardOverview,
};
