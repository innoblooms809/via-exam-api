import { Router } from "express";
import Controller from "../../controllers/aiEvaluation.controller";
import NewController from "../../controllers/aiEvaluationNew.controller";
import OCRNew5Controller from "../../controllers/ocrnew5.controller";
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


