import { Router } from "express";
import Controller from "../../../controllers/exam/examWorkflow.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import validate from "../../../middlewares/validate";
import Validation from "../../../validations/examWorkflow.validation";
import { ACADEMIC, ADMINS, MEMBERS, UPLOADERS } from "../../../config/roles";

// Exam workflow after paper approval — see services/exam/examWorkflow.service.ts.
const router = Router();
router.use(authenticate);

const admin = authorize(ADMINS);

// ── Admin: where every exam is in the workflow ───────────────────────────────
router.get("/exams", admin, validate(Validation.listPipeline), Controller.listPipeline);
router.get("/exams/:examId/timeline", authorize(MEMBERS), validate(Validation.examParam), Controller.getTimeline);

// ── Admin: scanner assignment ───────────────────────────────────────────────
router.get("/exams/:examId/scanners", admin, validate(Validation.examParam), Controller.listScanners);
router.post("/exams/:examId/scanner", admin, validate(Validation.assignScanner), Controller.assignScanner);
router.delete("/exams/:examId/scanner", admin, validate(Validation.examParam), Controller.unassignScanner);

// ── Scanner: assigned exams, roster, absentees, completion ───────────────────
router.get("/scanner/exams", authorize(UPLOADERS), validate(Validation.myScanExams), Controller.myScanExams);
router.get("/scanner/exams/:examId/roster", authorize(UPLOADERS), validate(Validation.examParam), Controller.scanRoster);
router.post("/scanner/exams/:examId/attendance", authorize(UPLOADERS), validate(Validation.setAttendance), Controller.setAttendance);
router.post("/scanner/exams/:examId/complete", authorize(UPLOADERS), validate(Validation.examParam), Controller.completeScan);

// ── Admin: results ───────────────────────────────────────────────────────────
router.post("/exams/:examId/publish", admin, validate(Validation.examParam), Controller.publishResults);
router.post("/exams/:examId/unpublish", admin, validate(Validation.examParam), Controller.unpublishResults);
router.get("/results", admin, validate(Validation.listResults), Controller.listResults);
// Class result sheet: students × subjects for one exam type (Mid Term / Final) of a session.
router.get("/results/class", admin, validate(Validation.classResults), Controller.classResults);

// ── Student: own results and one recheck per exam ────────────────────────────
router.get("/student/results", authorize(["STUDENT"]), validate(Validation.myResults), Controller.myResults);
router.post("/student/rechecks", authorize(["STUDENT"]), validate(Validation.createRecheck), Controller.createRecheck);

// ── Rechecks: admin assigns / rejects, teacher completes ─────────────────────
router.get("/rechecks", admin, validate(Validation.listRechecks), Controller.listRechecks);
router.post("/rechecks/:requestId/assign", admin, validate(Validation.assignRecheck), Controller.assignRecheck);
router.post("/rechecks/:requestId/reject", admin, validate(Validation.rejectRecheck), Controller.rejectRecheck);
router.get("/teacher/rechecks", authorize(ACADEMIC), validate(Validation.myRechecks), Controller.myRechecks);
router.post("/teacher/rechecks/:requestId/complete", authorize(ACADEMIC), validate(Validation.completeRecheck), Controller.completeRecheck);

export default router;
