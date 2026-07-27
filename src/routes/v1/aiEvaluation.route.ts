import { Router } from "express";
import Controller from "../../controllers/aiEvaluation.controller";
import NewController from "../../controllers/aiEvaluationNew.controller";
import { authenticate } from "../../middlewares/auth";

const router = Router();

// Trigger evaluation (legacy — uses old port 8002 API)
router.post(
  "/evaluate",
  authenticate,
  Controller.evaluateSheet
);

// Trigger evaluation V2 (new — uses OCR pipeline on port 8003)
router.post(
  "/evaluate2",
  authenticate,
  NewController.evaluateSheet2
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


