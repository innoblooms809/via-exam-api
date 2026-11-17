import { Router } from "express";
import Controller from "../../../controllers/evaluation/aiEvaluation.controller";
import Pipeline6Controller from "../../../controllers/evaluation/pipeline6.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ACADEMIC, SUPER_ADMIN } from "../../../config/roles";
import { requireSheetAccessMiddleware, requireSheetEvaluateMiddleware } from "../../../services/evaluation/evaluationAccess.service";
import { evaluationRunGuard } from "../../../services/evaluation/recheckDraft.service";
import validate from "../../../middlewares/validate";
import AIEvaluationValidation from "../../../validations/aiEvaluation.validation";

const router = Router();

router.post(
  "/evaluate6",
  authenticate,
  authorize(ACADEMIC),
  requireSheetEvaluateMiddleware,
  evaluationRunGuard,
  Pipeline6Controller.evaluateSheetPipeline6
);

// Pipeline 6 queue: sheets waiting for / running OCR and AI evaluation
router.get(
  "/queue",
  authenticate,
  authorize(ACADEMIC),
  Pipeline6Controller.getQueueStatus
);

// Everything about the queue, for developers: live jobs (every school's), services, events, failures.
router.get(
  "/queue/diagnostics",
  authenticate,
  authorize(SUPER_ADMIN),
  Pipeline6Controller.getQueueDiagnostics
);

// "Evaluate all": many sheets in one call, each with the same checks as /evaluate6
// (assigned evaluator, never published results, cross-checks by their checker only).
router.post(
  "/evaluate-batch",
  authenticate,
  authorize(ACADEMIC),
  validate(AIEvaluationValidation.evaluateBatch),
  Pipeline6Controller.evaluateBatch
);

// "Pause" / "Resume" on the queue page: the requester's own sheets only (assigned evaluator),
// resume with the same locks as evaluating (published results, cross-checks, completed sections).
router.post(
  "/pause-batch",
  authenticate,
  authorize(ACADEMIC),
  validate(AIEvaluationValidation.pauseBatch),
  Pipeline6Controller.pauseBatch
);
router.post(
  "/resume-batch",
  authenticate,
  authorize(ACADEMIC),
  validate(AIEvaluationValidation.resumeBatch),
  Pipeline6Controller.resumeBatch
);

// Status and queue place of many sheets: the queue page's single poll.
router.post(
  "/status-batch",
  authenticate,
  authorize(ACADEMIC),
  validate(AIEvaluationValidation.statusBatch),
  Pipeline6Controller.statusBatch
);

// Failed AI evaluations
router.get(
  "/failed",
  authenticate,
  authorize(ACADEMIC),
  Controller.getFailedEvaluations
);

// Get evaluation result by sheet ID
router.get(
  "/sheet/:sheetId",
  authenticate,
  authorize(ACADEMIC),
  requireSheetAccessMiddleware,
  Controller.getEvaluation
);

// Update evaluation details/marks by sheet ID
router.put(
  "/sheet/:sheetId",
  authenticate,
  authorize(ACADEMIC),
  requireSheetEvaluateMiddleware,
  Controller.updateEvaluation
);

export default router;

