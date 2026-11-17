import { Response } from "express";
import httpStatus from "http-status";
import Pipeline6Service from "../../services/evaluation/pipeline6.service";
import EvaluationBatchService from "../../services/evaluation/evaluationBatch.service";
import { msg } from "../../i18n/message";

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

    // req.recheck / req.crossCheck (evaluationRunGuard): a recheck teacher's or cross-checker's run, into their draft.
    const result = await Pipeline6Service.triggerPipeline6Evaluation(sheetId, force, req.recheck ?? null, req.crossCheck ?? null);
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
  try {
    return res.status(httpStatus.OK).json({
      error: false,
      statusCode: httpStatus.OK,
      message: "Evaluation queue status.",
      data: await Pipeline6Service.getQueueSnapshot(),
    });
  } catch (error: any) {
    return res.status(httpStatus.SERVICE_UNAVAILABLE).json({
      error: true,
      statusCode: httpStatus.SERVICE_UNAVAILABLE,
      message: `The evaluation queue is unavailable: ${error?.message || error}`,
    });
  }
};

// GET /v1/ai-evaluation/queue/diagnostics — for developers (super admin): every live job with its
// attempts and errors, the services' health, the last queue events, recent failures and other
// API processes on this database. The same events are in logs/queue.log.
const getQueueDiagnostics = async (_req: any, res: Response): Promise<any> => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.status(httpStatus.OK).json({
      error: false,
      statusCode: httpStatus.OK,
      message: "Evaluation queue diagnostics.",
      data: await Pipeline6Service.queueDiagnostics(),
    });
  } catch (error: any) {
    return res.status(httpStatus.SERVICE_UNAVAILABLE).json({
      error: true,
      statusCode: httpStatus.SERVICE_UNAVAILABLE,
      message: `The evaluation queue is unavailable: ${error?.message || error}`,
    });
  }
};

// POST /v1/ai-evaluation/evaluate-batch — "Evaluate all": queues up to 200 sheets in one call.
const evaluateBatch = async (req: any, res: Response): Promise<any> => {
  try {
    const data = await EvaluationBatchService.triggerBatch(req.viaExamUser, req.body.sheetIds, Boolean(req.body.force));
    return res.status(httpStatus.OK).json({
      error: false,
      statusCode: httpStatus.OK,
      message: `${data.counts.queued} of ${data.counts.requested} sheet(s) queued for AI evaluation.`,
      data,
    });
  } catch (error: any) {
    return res.status(error?.statusCode || httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: error?.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      message: error?.message || "Internal Server Error",
    });
  }
};

// POST /v1/ai-evaluation/status-batch — status and queue place of many sheets (the queue page's one poll).
const statusBatch = async (req: any, res: Response): Promise<any> => {
  try {
    const data = await EvaluationBatchService.statusBatch(req.viaExamUser, req.body.sheetIds);
    // Polled every few seconds: never cached by a proxy.
    res.setHeader("Cache-Control", "no-store");
    return res.status(httpStatus.OK).json({ error: false, statusCode: httpStatus.OK, message: "Evaluation status.", data });
  } catch (error: any) {
    return res.status(error?.statusCode || httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: error?.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      message: error?.message || "Internal Server Error",
    });
  }
};

// POST /v1/ai-evaluation/pause-batch — the queue page's "Pause": its sheets that haven't started
// leave the line; the ones already in OCR or the AI step go on to the end.
const pauseBatch = async (req: any, res: Response): Promise<any> => {
  try {
    const data = await EvaluationBatchService.pauseBatch(req.viaExamUser, req.body.sheetIds);
    return res.status(httpStatus.OK).json({ error: false, statusCode: httpStatus.OK, message: msg("Evaluation paused."), data });
  } catch (error: any) {
    return res.status(error?.statusCode || httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: error?.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      message: error?.localized ?? error?.message ?? "Internal Server Error",
    });
  }
};

// POST /v1/ai-evaluation/resume-batch — paused sheets back in line.
const resumeBatch = async (req: any, res: Response): Promise<any> => {
  try {
    const data = await EvaluationBatchService.resumeBatch(req.viaExamUser, req.body.sheetIds);
    return res.status(httpStatus.OK).json({ error: false, statusCode: httpStatus.OK, message: msg("Evaluation resumed."), data });
  } catch (error: any) {
    return res.status(error?.statusCode || httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: error?.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      message: error?.localized ?? error?.message ?? "Internal Server Error",
    });
  }
};

export default {
  evaluateSheetPipeline6,
  getQueueStatus,
  getQueueDiagnostics,
  evaluateBatch,
  statusBatch,
  pauseBatch,
  resumeBatch,
};
