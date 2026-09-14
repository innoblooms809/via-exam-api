import { Router } from "express";

import Controller from "../../controllers/studentdashboard.controller";

import { authenticate, authorize } from "../../middlewares/auth";

const router = Router();

router.get(
  "/overview",
  authenticate,
  Controller.getStudentDashboardOverview
);

router.get(
  "/exams/upcoming",
  authenticate,
  authorize(["STUDENT"]),
  Controller.getUpcomingExams
);

router.get(
  "/exam-progress",
  authenticate,
  authorize(["STUDENT"]),
  Controller.getExamProgress
);

router.get(
  "/performance",
  authenticate,
  authorize(["STUDENT"]),
  Controller.getPerformanceOverview
);

router.get(
  "/subject-comparison",
  authenticate,
  authorize(["STUDENT"]),
  Controller.getSubjectComparison
);

router.get(
  "/results/latest",
  authenticate,
  authorize(["STUDENT"]),
  Controller.getLatestResults
);

router.get(
  "/subject-performance",
  authenticate,
  authorize(["STUDENT"]),
  Controller.getSubjectPerformance
);

router.get(
  "/activity/recent",
  authenticate,
  authorize(["STUDENT"]),
  Controller.getRecentActivity
);

router.get(
  "/recheck-requests",
  authenticate,
  authorize(["STUDENT"]),
  Controller.getRecheckRequests
);

export default router;
