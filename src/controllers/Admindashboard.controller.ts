import { Request, Response } from "express";
import httpStatus from "http-status";
import AdmindashboardService from "../services/Admindashboard.service";

const getOverview = async (req: any, res: Response): Promise<any> => {
  try {
    const instituteId = req.viaExamUser.instituteId;

    const result = await AdmindashboardService.getOverview(instituteId);

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
};