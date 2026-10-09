import { Router } from "express";

import Controller from "../../../controllers/dashboard/adminDashboard.controller";

import { authenticate } from "../../../middlewares/auth";

const router = Router();

router.get("/overview", authenticate, Controller.getOverview);
router.get("/teacher-analytics", authenticate, Controller.getTeacherAnalytics);
router.get("/scanner-analytics", authenticate, Controller.getScannerAnalytics);
router.get("/student-analytics", authenticate, Controller.getStudentAnalytics);
router.get("/super-admin-analytics", authenticate, Controller.getSuperAdminAnalytics);

export default router;
