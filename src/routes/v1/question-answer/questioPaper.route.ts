import { Router } from "express";
import {
  createQuestionPaper,
  getQuestionPaperUploads,
  uploadImageController,
  getQuestionPaperBySelection,
  submitQuestionPaper,
  approveQuestionPaper,
  rejectQuestionPaper,
  publishQuestionPaper,
  getPendingQuestionPapers,
  getAllQuestionPapers,
} from "../../../controllers/question-Answer/questionPaper.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { questionPaperUpload } from "../../../utils/multer";
import { getExamBySelection } from "../../../controllers/exam/getExamBySelection";

const router = Router();

router.post(
  "/getExamBySelection",
  authenticate,
  getExamBySelection
);

router.post(
  "/createQuestionPaper",
  authenticate,
  createQuestionPaper
);

router.post(
  "/image",
  questionPaperUpload,
  uploadImageController
);

router.get("/uploads", getQuestionPaperUploads);

router.post(
  "/getQuestionPaperBySet",
  authenticate,
  getQuestionPaperBySelection
);

// ─── APPROVAL WORKFLOW ROUTES ──────────────────────────────────────────────

// Teacher submits paper for review
router.patch(
  "/submitQuestionPaper/:paperId/submit",
  authenticate,
  submitQuestionPaper
);

// Admin/Examiner approve
router.patch(
  "/approveQuestionPaper/:paperId/approve",
  authenticate,
  // authorize(["ADMIN", "EXAMINER"]),
  approveQuestionPaper
);

// Admin/Examiner reject
router.patch(
  "/rejectQuestionPaper/:paperId/reject",
  authenticate,
  // authorize(["ADMIN", "EXAMINER"]),
  rejectQuestionPaper
);

// Admin publish
router.patch(
  "/publishQuestionPaper/:paperId/publish",
  authenticate,
  // authorize(["ADMIN"]),
  publishQuestionPaper
);

// Get pending papers (for admin/examiner review dashboard)
router.get(
  "/pending",
  authenticate,
  // authorize(["ADMIN", "EXAMINER"]),
  getPendingQuestionPapers
);

// Get all papers with optional filters (status, examId, teacherId)
router.get(
  "/getAllQuestionPapers",
  authenticate,
  getAllQuestionPapers
);

export default router;
