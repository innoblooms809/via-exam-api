import { Router } from "express";

import Controller from "../../../controllers/dashboard/home.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ADMINS, TEACHERS } from "../../../config/roles";

const router = Router();

// One request per role home page; each returns everything above the fold.
// GET /v1/home/admin    — institute KPIs, exam pipeline, needs-attention counts, queues
// GET /v1/home/teacher  — papers to set, evaluations / rechecks assigned to me
// GET /v1/home/scanner  — my scanning assignments and uploads
// GET /v1/home/student  — my timetable, published results and rechecks
router.get("/admin", authenticate, authorize(ADMINS), Controller.getAdminHome);
// GET /v1/home/setup    — master-data checklist for a new institute (session → classes → … → first exam)
router.get("/setup", authenticate, authorize(ADMINS), Controller.getSetupStatus);
// GET /v1/home/people/:userId — one teacher, scanner or student: profile, numbers and full history
router.get("/people/:userId", authenticate, authorize(ADMINS), Controller.getPerson);
router.get("/teacher", authenticate, authorize(TEACHERS), Controller.getTeacherHome);
router.get("/scanner", authenticate, authorize(["SCANNER"]), Controller.getScannerHome);
router.get("/student", authenticate, authorize(["STUDENT"]), Controller.getStudentHome);

export default router;
