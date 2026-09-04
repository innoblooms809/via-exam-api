import { Router } from "express";

import Controller from "../../controllers/studentdashboard.controller";

import { authenticate } from "../../middlewares/auth";

const router = Router();

router.get(
  "/overview",
  authenticate,
  Controller.getStudentDashboardOverview
);

export default router;
