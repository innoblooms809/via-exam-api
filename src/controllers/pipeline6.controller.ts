import { Response } from "express";
import httpStatus from "http-status";
import Pipeline6Service from "../services/pipeline6.service";

// POST /v1/ai-evaluation/evaluate-pipeline6
const evaluateSheetPipeline6 = async (req: any, res: Response): Promise<any> => {
  try {
    const { sheetId, force } = req.body;
    if (!sheetId) {
      return res.status(httpStatus.BAD_REQUEST).json({
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "sheetId is required.",
      });
    }

    const result = await Pipeline6Service.triggerPipeline6Evaluation(sheetId, force);
    return res.status(result.statusCode).send(result);
  } catch (error: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: error.message || "Internal Server Error",
    });
  }
};

// GET /v1/ai-evaluation/queue — how many sheets are in OCR / AI evaluation right now.
const getQueueStatus = async (_req: any, res: Response): Promise<any> => {
  return res.status(httpStatus.OK).json({
    error: false,
    statusCode: httpStatus.OK,
    message: "Evaluation queue status.",
    data: Pipeline6Service.getQueueSnapshot(),
  });
};

export default {
  evaluateSheetPipeline6,
  getQueueStatus,
};
