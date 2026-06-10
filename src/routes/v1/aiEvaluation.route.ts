import { Router } from "express";
import Controller from "../../controllers/aiEvaluation.controller";
import { authenticate } from "../../middlewares/auth";

const router = Router();

// Trigger evaluation
router.post(
  "/evaluate",
  authenticate,
  Controller.evaluateSheet
);

// Get evaluation result by sheet ID
router.get(
  "/sheet/:sheetId",
  authenticate,
  Controller.getEvaluation
);

// List evaluations
router.get(
  "/list",
  authenticate,
  Controller.getAllEvaluations
);

export default router;
