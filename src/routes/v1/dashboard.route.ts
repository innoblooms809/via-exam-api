import { Router } from "express";

import Controller from "../../controllers/dashboard.controller";

import { authenticate } from "../../middlewares/auth";

const router = Router();

router.get(
  "/institutes",
  authenticate,
  Controller.getInstituteStats
);

router.get(
  "/students",
  authenticate,
  Controller.getStudentStats
);

router.get(
  "/exams",
  authenticate,
  Controller.getExamStats
);

router.get(
  "/evaluated-sheets",
  authenticate,
  Controller.getEvaluatedAnswersheetStats
);

export default router;