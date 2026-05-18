import { Response } from "express";
import httpStatus from "http-status";
import ExamService from "../../services/exam.service"

const createExam = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await ExamService.createExam(req.body, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getAllExams = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await ExamService.getAllExams(req.query, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const getExamById = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await ExamService.getExamById(
      req.params.examId,
      req.viaExamUser,
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

const updateExamStatus = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await ExamService.updateExamStatus(
      req.params.examId,
      req.body.status,
      req.viaExamUser,
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

const updateExam = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await ExamService.updateExam(
      req.params.examId,
      req.body,
      req.viaExamUser,
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

const deleteExam = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await ExamService.deleteExam(
      req.params.examId,
      req.viaExamUser,
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
  createExam,
  getAllExams,
  getExamById,
  updateExamStatus,
  updateExam,
  deleteExam,
};
