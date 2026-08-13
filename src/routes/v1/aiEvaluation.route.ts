import { Router } from "express";
import Controller from "../../controllers/aiEvaluation.controller";
import NewController from "../../controllers/aiEvaluationNew.controller";
import OCRNew5Controller from "../../controllers/ocrnew5.controller";
import Pipeline6Controller from "../../controllers/pipeline6.controller";
import { authenticate } from "../../middlewares/auth";

const router = Router();

// Trigger evaluation (legacy — uses old port 8002 API)
router.post(
  "/evaluate",
  authenticate,
  Controller.evaluateSheet
);

// Trigger evaluation V2 (uses OCR pipeline on port 8003/8005)
router.post(
  "/evaluate2",
  authenticate,
  NewController.evaluateSheet2
);

// Trigger evaluation OCRNew5 (uses multi-agent pipeline on port 8006)
router.post(
  "/evaluate-ocrnew5",
  authenticate,
  OCRNew5Controller.evaluateSheetOCRNew5
);

// Trigger evaluation Pipeline 6.3 (uses 9-agent pipeline with rubric pre-warming on port 8007)
router.post(
  "/evaluate-pipeline6",
  authenticate,
  Pipeline6Controller.evaluateSheetPipeline6
);

router.post(
  "/evaluate6",
  authenticate,
  Pipeline6Controller.evaluateSheetPipeline6
);


// Get evaluation result by sheet ID
router.get(
  "/sheet/:sheetId",
  authenticate,
  Controller.getEvaluation
);

// Update evaluation details/marks by sheet ID
router.put(
  "/sheet/:sheetId",
  authenticate,
  Controller.updateEvaluation
);

// List evaluations
router.get(
  "/list",
  authenticate,
  Controller.getAllEvaluations
);

export default router;


