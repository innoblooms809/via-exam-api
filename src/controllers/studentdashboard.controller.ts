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

export default {
  getStudentDashboardOverview,
};
