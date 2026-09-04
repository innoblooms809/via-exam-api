import { Router } from "express";

import Controller from "../../controllers/teacherdashboard.controller";

import { authenticate } from "../../middlewares/auth";

const router = Router();

router.get(
  "/overview",
  authenticate,
  Controller.getTeacherDashboardOverview
);

export default router;
