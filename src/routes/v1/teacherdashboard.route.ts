import { Router } from "express";

import Controller from "../../controllers/teacherdashboard.controller";

import { authenticate, authorize } from "../../middlewares/auth";

const router = Router();

router.get(
  "/overview",
  authenticate,
  authorize(["TEACHER"]),
  Controller.getTeacherDashboardOverview
);

router.get(
  "/upcoming-exams",
  authenticate,
  authorize(["TEACHER"]),
  Controller.getUpcomingExams
);

router.get(
  "/exam-activity",
  authenticate,
  authorize(["TEACHER"]),
  Controller.getExamActivity
);

router.get(
  "/activity-overview",
  authenticate,
  authorize(["TEACHER"]),
  Controller.getActivityOverview
);

router.get(
  "/upcoming-work",
  authenticate,
  authorize(["TEACHER"]),
  Controller.getUpcomingWork
);

router.get(
  "/evaluation-status",
  authenticate,
  authorize(["TEACHER"]),
  Controller.getEvaluationStatus
);

router.get(
  "/subject-workload",
  authenticate,
  authorize(["TEACHER"]),
  Controller.getSubjectWorkload
);

router.get(
  "/activity/recent",
  authenticate,
  authorize(["TEACHER"]),
  Controller.getRecentActivity
);

export default router;
