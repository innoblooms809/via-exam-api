import { Response } from "express";
import httpStatus from "http-status";
import RecheckRequestService from "../services/recheckRequest.service";

const createRecheckRequest = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await RecheckRequestService.createRecheckRequest(req.body, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getStudentRecheckRequests = async (req: any, res: Response): Promise<any> => {
  try {
    const studentId = req.viaExamUser.userId;
    const instituteId = req.viaExamUser.instituteId;
    const result = await RecheckRequestService.getStudentRecheckRequests(studentId, instituteId, req.query);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getRecheckRequestById = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await RecheckRequestService.getRecheckRequestById(req.params.requestId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const updateRecheckRequestStatus = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await RecheckRequestService.updateRecheckRequestStatus(
      req.params.requestId,
      { status: req.body.status, reviewerId: req.viaExamUser.userId },
      req.viaExamUser
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
  createRecheckRequest,
  getStudentRecheckRequests,
  getRecheckRequestById,
  updateRecheckRequestStatus,
};