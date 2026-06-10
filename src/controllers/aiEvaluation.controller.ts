import { Response } from "express";
import httpStatus from "http-status";
import AIEvaluationService from "../services/aiEvaluation.service";

// POST /v1/ai-evaluation/evaluate
const evaluateSheet = async (req: any, res: Response): Promise<any> => {
  try {
    const { sheetId, force } = req.body;
    if (!sheetId) {
      return res.status(httpStatus.BAD_REQUEST).json({
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "sheetId is required.",
      });
    }

    const result = await AIEvaluationService.triggerEvaluation(sheetId, force);
    return res.status(result.statusCode).send(result);
  } catch (error: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: error.message || "Internal Server Error",
    });
  }
};

// GET /v1/ai-evaluation/sheet/:sheetId
const getEvaluation = async (req: any, res: Response): Promise<any> => {
  try {
    const { sheetId } = req.params;
    if (!sheetId) {
      return res.status(httpStatus.BAD_REQUEST).json({
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "sheetId parameter is required.",
      });
    }

    const result = await AIEvaluationService.getEvaluationBySheetId(sheetId);
    return res.status(result.statusCode).send(result);
  } catch (error: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: error.message || "Internal Server Error",
    });
  }
};

// GET /v1/ai-evaluation/list
const getAllEvaluations = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await AIEvaluationService.getAllEvaluations(req.query, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: error.message || "Internal Server Error",
    });
  }
};

export default {
  evaluateSheet,
  getEvaluation,
  getAllEvaluations,
};
