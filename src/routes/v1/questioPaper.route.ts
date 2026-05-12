import { Router } from "express";
import Controller from "../../controllers/questionPaper.controller";
import { authenticate, authorize } from "../../middlewares/auth";

const router = Router();

// ─────────────────────────────────────────────────────────────────
// TEACHER ROUTES
// ─────────────────────────────────────────────────────────────────

// POST /api/viaexam/question-papers
// Teacher creates or updates a question paper draft
// Body: { examId: string, content: object }
router.post(
  "/",
  authenticate,
  authorize(["teacher"]),
  Controller.saveDraft
);

// PATCH /api/viaexam/question-papers/:paperId/submit
// Teacher submits the draft for examiner review
router.patch(
  "/:paperId/submit",
  authenticate,
  authorize(["teacher"]),
  Controller.submitPaper
);

// GET /api/viaexam/question-papers/teacher/my-exams
// Teacher sees all exams assigned to them + current paper status
// Query: ?status=Draft|Submitted|Approved|Rejected  ?page=1&limit=10
// ⚠️  Must be defined BEFORE /:paperId routes — "teacher" is not a param
router.get(
  "/teacher/my-exams",
  authenticate,
  authorize(["teacher"]),
  Controller.getMyExams
);

// ─────────────────────────────────────────────────────────────────
// EXAMINER ROUTES
// ─────────────────────────────────────────────────────────────────

// GET /api/viaexam/question-papers/submitted
// Examiner sees all submitted papers pending review
// Query: ?class=Class 10&subject=Mathematics&page=1&limit=10
// ⚠️  Must be defined BEFORE /:paperId routes — "submitted" is not a param
router.get(
  "/submitted",
  authenticate,
  authorize(["examiner"]),
  Controller.getSubmittedPapers
);

// PATCH /api/viaexam/question-papers/:paperId/approve
// Examiner approves → paper = Approved, exam = Live
router.patch(
  "/:paperId/approve",
  authenticate,
  authorize(["examiner"]),
  Controller.approvePaper
);

// PATCH /api/viaexam/question-papers/:paperId/reject
// Examiner rejects → paper = Rejected (with note), exam = Draft
// Body: { rejectionNote: string }
router.patch(
  "/:paperId/reject",
  authenticate,
  authorize(["examiner"]),
  Controller.rejectPaper
);

export default router;