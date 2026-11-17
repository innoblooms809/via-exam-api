import { Response } from "express";
import httpStatus from "http-status";
import ExamService from "../../services/exam/exam.service"
import EvaluationAssignmentService from "../../services/evaluation/evaluationAssignment.service";

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

const getAssignedExams = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await ExamService.getAssignedExams(req.viaExamUser);
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

const getExamProgress = async (req: any, res: Response): Promise<any> => {
  try {
    try {
      await EvaluationAssignmentService.examProgressAccess(req.viaExamUser, req.params.examId);
    } catch (err: any) {
      return res.status(err.statusCode || httpStatus.FORBIDDEN).json({ error: true, statusCode: err.statusCode, message: err.message });
    }
    const result = await ExamService.getExamProgress(req.params.examId, req.viaExamUser);
    return res.status(result.statusCode).json(result);
  } catch (e: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      message: `Something went wrong: ${e.message}`,
    });
  }
};

export default {
  getExamProgress,
  createExam,
  updateExamStatus,
  updateExam,
  deleteExam,
  getAssignedExams,
};
