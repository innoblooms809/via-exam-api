import { Router } from "express";

import Controller from "../../controllers/scannerdashboard.controller";

import { authenticate, authorize } from "../../middlewares/auth";

const router = Router();

router.get(
  "/kpis",
  authenticate,
  authorize(["SCANNER"]),
  Controller.getKpis
);

router.get(
  "/hourly-activity",
  authenticate,
  authorize(["SCANNER"]),
  Controller.getHourlyActivity
);

router.get(
  "/status-distribution",
  authenticate,
  authorize(["SCANNER"]),
  Controller.getStatusDistribution
);

router.get(
  "/recent-scans",
  authenticate,
  authorize(["SCANNER"]),
  Controller.getRecentScans
);

router.get(
  "/exam-progress",
  authenticate,
  authorize(["SCANNER"]),
  Controller.getExamProgress
);

router.get(
  "/pending-scans",
  authenticate,
  authorize(["SCANNER"]),
  Controller.getPendingScans
);

router.get(
  "/recent-activity",
  authenticate,
  authorize(["SCANNER"]),
  Controller.getRecentActivity
);

export default router;
