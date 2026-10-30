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
// Not scanner staff: the timeline tells the evaluation's story, which they never see.
router.get("/exams/:examId/timeline", authorize(MEMBERS.filter((r) => r !== "SCANNER")), validate(Validation.examParam), Controller.getTimeline);

// ── Admin: scanner assignment ───────────────────────────────────────────────
router.get("/exams/:examId/scanners", admin, validate(Validation.examParam), Controller.listScanners);
router.post("/exams/:examId/scanner", admin, validate(Validation.assignScanner), Controller.assignScanner);
router.delete("/exams/:examId/scanner", admin, validate(Validation.examParam), Controller.unassignScanner);

// ── Scanner: assigned exams, roster, absentees, completion ───────────────────
router.get("/scanner/exams", authorize(UPLOADERS), validate(Validation.myScanExams), Controller.myScanExams);
router.get("/scanner/exams/:examId/roster", authorize(UPLOADERS), validate(Validation.examParam), Controller.scanRoster);
// Absentees and "upload complete" are the scanner's (the admin sees them, re-opens on request).
router.post("/scanner/exams/:examId/attendance", authorize(["SCANNER"]), validate(Validation.setAttendance), Controller.setAttendance);
router.post("/scanner/exams/:examId/complete", authorize(["SCANNER"]), validate(Validation.examParam), Controller.completeScan);
// A completed upload re-opens only through the admin: the scanner asks, the admin decides.
router.post("/scanner/exams/:examId/reopen-request", authorize(["SCANNER"]), validate(Validation.requestReopen), Controller.requestReopen);

// ── Admin: scanners' requests to re-open a completed upload ──────────────────
router.get("/reopen-requests", admin, validate(Validation.listReopenRequests), Controller.listReopenRequests);
router.post("/reopen-requests/:requestId/approve", admin, validate(Validation.decideReopen), Controller.approveReopen);
router.post("/reopen-requests/:requestId/reject", admin, validate(Validation.decideReopen), Controller.rejectReopen);

// ── Admin: results ───────────────────────────────────────────────────────────
router.post("/exams/:examId/publish", admin, validate(Validation.examParam), Controller.publishResults);
router.post("/exams/:examId/unpublish", admin, validate(Validation.examParam), Controller.unpublishResults);
router.get("/results", admin, validate(Validation.listResults), Controller.listResults);
// Class result sheet: students × subjects for one exam type (Mid Term / Final) of a session.
router.get("/results/class", admin, validate(Validation.classResults), Controller.classResults);

// ── Student: own results, report card and one recheck claim per exam ─────────
router.get("/student/results", authorize(["STUDENT"]), validate(Validation.myResults), Controller.myResults);
// The report card as the school prints it (only the student's own row of the class sheet).
router.get("/student/report-card", authorize(["STUDENT"]), validate(Validation.myReportCard), Controller.myReportCard);
// One result in full: question-wise marks and feedback as far as the school shows them.
router.get("/student/results/:resultId", authorize(["STUDENT"]), validate(Validation.resultParam), Controller.myResultDetail);
router.get("/student/rechecks", authorize(["STUDENT"]), validate(Validation.myClaims), Controller.myClaims);
router.post("/student/rechecks", authorize(["STUDENT"]), validate(Validation.createRecheck), Controller.createRecheck);

// ── Rechecks: admin assigns / rejects, teacher decides, admin approves ───────
router.get("/rechecks", admin, validate(Validation.listRechecks), Controller.listRechecks);
// One answer sheet's marks history: evaluator, cross-check, recheck, who changed what.
router.get("/sheets/:sheetId/history", admin, validate(Validation.sheetParam), Controller.sheetHistory);
// An exam's full report: every student from scanning to result and recheck.
router.get("/exams/:examId/report", admin, validate(Validation.examParam), Controller.examReport);
router.post("/rechecks/:requestId/assign", admin, validate(Validation.assignRecheck), Controller.assignRecheck);
router.post("/rechecks/:requestId/reject", admin, validate(Validation.rejectRecheck), Controller.rejectRecheck);
// The teacher's decision reaches the result only once an admin approves it.
router.post("/rechecks/:requestId/approve", admin, validate(Validation.approveRecheck), Controller.approveRecheck);
router.post("/rechecks/:requestId/return", admin, validate(Validation.returnRecheck), Controller.returnRecheck);
router.get("/teacher/rechecks", authorize(ACADEMIC), validate(Validation.myRechecks), Controller.myRechecks);
router.post("/teacher/rechecks/:requestId/complete", authorize(ACADEMIC), validate(Validation.completeRecheck), Controller.completeRecheck);

export default router;
