import { Response } from "express";
import httpStatus from "http-status";
import AIEvaluationService from "../../services/evaluation/aiEvaluation.service";
import { maskEvaluationIdentity, scopeEvaluationRows } from "../../services/evaluation/evaluationAccess.service";
import { ensureSheetQuality, scanQualityView } from "../../services/answer-sheet/sheetQuality.service";
import Pipeline6Service from "../../services/evaluation/pipeline6.service";
import { recheckFor, recheckView, saveRecheckDraft, sheetPublished } from "../../services/evaluation/recheckDraft.service";
import { crossCheckFor, crossCheckView, saveCrossCheckDraft } from "../../services/evaluation/crossCheckDraft.service";
import { sheetHeldForCrossCheck } from "../../services/exam/crossCheck.service";

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

    // A recheck or cross-check run goes into that draft, which only pipeline 6 writes.
    const result = req.recheck || req.crossCheck
      ? await Pipeline6Service.triggerPipeline6Evaluation(sheetId, true, req.recheck ?? null, req.crossCheck ?? null)
      : await AIEvaluationService.triggerEvaluation(sheetId, force);
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
      // Published results are read only on this screen, except for the teacher rechecking
      // this sheet, who sees (and edits) their draft over the published marks. The sheet's
      // cross-checker likewise sees their draft over the evaluator's marks.
      const [published, recheck, crossCheck, held] = await Promise.all([
        sheetPublished(sheetId),
        recheckFor(req.viaExamUser, sheetId),
        crossCheckFor(req.viaExamUser, sheetId),
        sheetHeldForCrossCheck(sheetId),
      ]);
      const base = {
        ...plain,
        // While a cross-check holds the sheet, only its checker changes the marks (into a draft).
        canEvaluate: req.canEvaluate !== false && !published && !held,
        crossCheckHeld: Boolean(held) && !crossCheck,
        resultsPublished: published,
        // A poor scan means the AI may have misread it; the evaluator checks the marks harder.
        scanQuality: scanQualityView(req.accessSheet),
      };
      result.data = recheck ? recheckView(base, recheck) : crossCheck && !published ? crossCheckView(base, crossCheck) : base;
    }
    // Sheets uploaded before the quality check get checked the first time they're opened.
    ensureSheetQuality(req.accessSheet);
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
    const { totalScore, evaluations, feedback, reason } = req.body;
    if (!sheetId) {
      return res.status(httpStatus.BAD_REQUEST).json({
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "sheetId parameter is required.",
      });
    }

    // The recheck teacher's marks go into their recheck draft; the published marks stay
    // until the admin approves the decision.
    const recheck = await recheckFor(req.viaExamUser, sheetId);
    if (recheck) {
      try {
        await saveRecheckDraft(recheck, { totalScore, evaluations, feedback });
      } catch (err: any) {
        const statusCode = err?.statusCode || httpStatus.INTERNAL_SERVER_ERROR;
        return res.status(statusCode).json({ error: true, statusCode, message: err?.message || "The marks weren't saved." });
      }
      const plain = recheck.evaluation.get({ plain: true });
      const view = recheckView(req.sheetAccess === "masked" ? maskEvaluationIdentity(plain, req.accessSheet) : plain, recheck);
      return res.status(httpStatus.OK).send({
        error: false,
        statusCode: httpStatus.OK,
        message: "Recheck marks saved as your draft. The student sees them once the admin approves your decision.",
        data: view,
      });
    }

    // The cross-checker's marks go into their cross-check draft; the evaluator's marks stay
    // until their verdict.
    const crossCheck = await crossCheckFor(req.viaExamUser, sheetId);
    if (crossCheck) {
      try {
        await saveCrossCheckDraft(crossCheck, { totalScore, evaluations, feedback });
      } catch (err: any) {
        const statusCode = err?.statusCode || httpStatus.INTERNAL_SERVER_ERROR;
        return res.status(statusCode).json({ error: true, statusCode, message: err?.message || "The marks weren't saved." });
      }
      const plain = crossCheck.evaluation.get({ plain: true });
      const view = crossCheckView(req.sheetAccess === "masked" ? maskEvaluationIdentity(plain, req.accessSheet) : plain, crossCheck);
      return res.status(httpStatus.OK).send({
        error: false,
        statusCode: httpStatus.OK,
        message: "Saved as your cross-check draft. The marks change once you give your verdict.",
        data: view,
      });
    }

    const result = await AIEvaluationService.updateEvaluationBySheetId(
      sheetId,
      { totalScore, evaluations, feedback, reason },
      req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (error: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: error.message || "Internal Server Error",
    });
  }
};

// GET /v1/ai-evaluation/failed
const getFailedEvaluations = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await AIEvaluationService.getFailedEvaluations(req.viaExamUser, req.query);
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
  getFailedEvaluations,
};

