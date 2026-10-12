import { Router } from "express";

import Controller from "../../../controllers/dashboard/adminDashboard.controller";
import SuperAdminController from "../../../controllers/dashboard/superAdminDashboard.controller";

import { authenticate, authorize } from "../../../middlewares/auth";
import { ADMINS } from "../../../config/roles";

const router = Router();

router.get("/overview", authenticate, authorize(ADMINS), Controller.getOverview);
router.get("/teacher-analytics", authenticate, authorize(ADMINS), Controller.getTeacherAnalytics);
router.get("/scanner-analytics", authenticate, authorize(ADMINS), Controller.getScannerAnalytics);
router.get("/student-analytics", authenticate, authorize(ADMINS), Controller.getStudentAnalytics);

// ── Super admin dashboard (platform-wide; each section loads on its own) ──────
// GET /v1/admin-dashboard/super-admin/summary              — KPIs, alerts, revenue, subscription mix
// GET /v1/admin-dashboard/super-admin/trends?months=12     — monthly revenue & usage series (3–24)
// GET /v1/admin-dashboard/super-admin/institutes?sort=recent|students|exams|sheets&limit=8
// GET /v1/admin-dashboard/super-admin/renewals?limit=6     — trials/periods ending in the next 7 days
// GET /v1/admin-dashboard/super-admin/live                 — users online now
const superAdmin = [authenticate, authorize(["SUPER_ADMIN"])];
router.get("/super-admin/summary", ...superAdmin, SuperAdminController.getSummary);
router.get("/super-admin/trends", ...superAdmin, SuperAdminController.getTrends);
router.get("/super-admin/institutes", ...superAdmin, SuperAdminController.getInstitutes);
router.get("/super-admin/renewals", ...superAdmin, SuperAdminController.getRenewals);
router.get("/super-admin/live", ...superAdmin, SuperAdminController.getLive);

// ── Super admin reports (paged; page, limit ≤ 100, search on every list) ──────
// GET /super-admin/reports/institutes   ?sort=name|createdAt|students|teachers|exams|sheets|evaluations|failedEvaluations|revenue|lastActiveAt|accessEndsAt&order=asc|desc&status&planKey
// GET /super-admin/reports/activity     ?from=YYYY-MM&to=YYYY-MM&activeOnly=true|false&sort=total|exams|sheets|evaluations|failedEvaluations|students|teachers|name
// GET /super-admin/reports/revenue      ?months=1-24
// GET /super-admin/reports/evaluations  ?status=Failed|Success|Pending&range=24h|7d|30d|90d|1y|all&instituteId
// GET /super-admin/reports/answer-sheets ?stage=evaluated|failed|evaluating|waiting&range&instituteId
// GET /super-admin/reports/exams        ?status&when=upcoming|past|unscheduled&sort=createdAt|examDate|upcoming&instituteId
// GET /super-admin/platform             — read-only platform facts for the settings page
router.get("/super-admin/reports/institutes", ...superAdmin, SuperAdminController.getInstitutesReport);
router.get("/super-admin/reports/activity", ...superAdmin, SuperAdminController.getActivityReport);
router.get("/super-admin/reports/revenue", ...superAdmin, SuperAdminController.getRevenueReport);
router.get("/super-admin/reports/evaluations", ...superAdmin, SuperAdminController.getEvaluationsReport);
router.get("/super-admin/reports/answer-sheets", ...superAdmin, SuperAdminController.getAnswerSheetsReport);
router.get("/super-admin/reports/exams", ...superAdmin, SuperAdminController.getExamsReport);
router.get("/super-admin/platform", ...superAdmin, SuperAdminController.getPlatform);

export default router;
