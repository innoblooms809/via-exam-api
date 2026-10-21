import { Router } from "express";

import Controller from "../../../controllers/dashboard/home.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ADMINS, TEACHERS } from "../../../config/roles";

const router = Router();

// One request per role home page; each returns everything above the fold.
// GET /v1/home/admin?sessionId= — institute KPIs, exam pipeline, needs-attention counts, analytics, queues
//   (sessionId: a session of the school, "all", or blank for the current one)
// GET /v1/home/teacher  — papers to set, evaluations / rechecks assigned to me
// GET /v1/home/scanner  — my scanning assignments and uploads
// GET /v1/home/student  — my timetable, published results and rechecks
router.get("/admin", authenticate, authorize(ADMINS), Controller.getAdminHome);
// GET /v1/home/setup    — master-data checklist for a new institute (session → classes → … → first exam)
router.get("/setup", authenticate, authorize(ADMINS), Controller.getSetupStatus);
// GET /v1/home/people/:userId?sessionId=&examType= — one teacher, scanner or student: profile, numbers and the
// first page of work and history for a session (default: the current one; "all" for every session)
router.get("/people/:userId", authenticate, authorize(ADMINS), Controller.getPerson);
// Next pages, by the cursor the previous page returned (same sessionId / examType):
// GET /v1/home/people/:userId/work?status=pending|done&group=&sessionId=&cursor=&limit=
// GET /v1/home/people/:userId/history?sessionId=&kind=&cursor=&limit=
router.get("/people/:userId/work", authenticate, authorize(ADMINS), Controller.getPersonWork);
router.get("/people/:userId/history", authenticate, authorize(ADMINS), Controller.getPersonHistory);
router.get("/teacher", authenticate, authorize(TEACHERS), Controller.getTeacherHome);
router.get("/scanner", authenticate, authorize(["SCANNER"]), Controller.getScannerHome);
router.get("/student", authenticate, authorize(["STUDENT"]), Controller.getStudentHome);

export default router;
