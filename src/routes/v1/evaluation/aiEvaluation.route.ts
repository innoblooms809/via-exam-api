import { Router } from "express";
import Controller from "../../../controllers/evaluation/aiEvaluation.controller";
import NewController from "../../../controllers/evaluation/aiEvaluationNew.controller";
import OCRNew5Controller from "../../../controllers/evaluation/ocrnew5.controller";
import Pipeline6Controller from "../../../controllers/evaluation/pipeline6.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ACADEMIC } from "../../../config/roles";
import { requireSheetAccessMiddleware, requireSheetEvaluateMiddleware } from "../../../services/evaluation/evaluationAccess.service";

const router = Router();

// Trigger evaluation (legacy — uses old port 8002 API)
router.post(
  "/evaluate",
  authenticate,
  authorize(ACADEMIC),
  requireSheetEvaluateMiddleware,
  Controller.evaluateSheet
);

// Trigger evaluation V2 (uses OCR pipeline on port 8003/8005)
router.post(
  "/evaluate2",
  authenticate,
  authorize(ACADEMIC),
  requireSheetEvaluateMiddleware,
  NewController.evaluateSheet2
);

// Trigger evaluation OCRNew5 (uses multi-agent pipeline on port 8006)
router.post(
  "/evaluate-ocrnew5",
  authenticate,
  authorize(ACADEMIC),
  requireSheetEvaluateMiddleware,
  OCRNew5Controller.evaluateSheetOCRNew5
);

// Trigger evaluation Pipeline 6.3 (uses 9-agent pipeline with rubric pre-warming on port 8007)
router.post(
  "/evaluate-pipeline6",
  authenticate,
  authorize(ACADEMIC),
  requireSheetEvaluateMiddleware,
  Pipeline6Controller.evaluateSheetPipeline6
);

router.post(
  "/evaluate6",
  authenticate,
  authorize(ACADEMIC),
  requireSheetEvaluateMiddleware,
  Pipeline6Controller.evaluateSheetPipeline6
);

// Pipeline 6 queue: sheets waiting for / running OCR and AI evaluation
router.get(
  "/queue",
  authenticate,
  authorize(ACADEMIC),
  Pipeline6Controller.getQueueStatus
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

// List evaluations
router.get(
  "/list",
  authenticate,
  authorize(ACADEMIC),
  Controller.getAllEvaluations
);

export default router;


