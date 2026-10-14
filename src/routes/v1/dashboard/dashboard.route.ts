import { Router } from "express";
import Controller from "../../../controllers/dashboard/dashboard.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { SUPER_ADMIN } from "../../../config/roles";

const router = Router();

// Platform-wide counts across every institute: super admin only.
router.get("/institutes", authenticate, authorize(SUPER_ADMIN), Controller.getInstituteStats);
router.get("/students", authenticate, authorize(SUPER_ADMIN), Controller.getStudentStats);
router.get("/exams", authenticate, authorize(SUPER_ADMIN), Controller.getExamStats);
router.get("/evaluated-sheets", authenticate, authorize(SUPER_ADMIN), Controller.getEvaluatedAnswersheetStats);

export default router;
