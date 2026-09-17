import { Response } from "express";
import httpStatus from "http-status";
import AIEvaluationService from "../services/aiEvaluation.service";
import { maskEvaluationIdentity, scopeEvaluationRows } from "../services/evaluationAccess.service";

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
    // Assigned evaluators never receive the student's identity.
    if (!result.error && req.sheetAccess === "masked" && result.data) {
      result.data = maskEvaluationIdentity(result.data, req.accessSheet);
    }
    if (!result.error && result.data) {
      const plain = typeof result.data.toJSON === "function" ? result.data.toJSON() : result.data;
      result.data = { ...plain, canEvaluate: req.canEvaluate !== false };
    }
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
    if (!result.error && Array.isArray(result.data?.evaluations)) {
      const evaluations = await scopeEvaluationRows(req.viaExamUser, result.data.evaluations);
      result.data = { ...result.data, evaluations, total: evaluations.length };
    }
    return res.status(result.statusCode).send(result);
  } catch (error: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: error.message || "Internal Server Error",
    });
  }
};

// PUT /v1/ai-evaluation/sheet/:sheetId
const updateEvaluation = async (req: any, res: Response): Promise<any> => {
  try {
    const { sheetId } = req.params;
    const { totalScore, evaluations, feedback } = req.body;
    if (!sheetId) {
      return res.status(httpStatus.BAD_REQUEST).json({
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "sheetId parameter is required.",
      });
    }

    const result = await AIEvaluationService.updateEvaluationBySheetId(sheetId, {
      totalScore,
      evaluations,
      feedback,
    });
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
  updateEvaluation,
};

