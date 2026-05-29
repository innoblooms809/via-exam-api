import express from "express";

import {
  createQuestionPaperAnswer,
  uploadImageController,
  getQuestionPaperAnswerBySelection,
  getQuestionPaperAnswerUploads,
  submitAnswerSheet,
  approveAnswerSheet,
  rejectAnswerSheet,
  publishAnswerSheet,
  getPendingAnswerSheets,
  getAllAnswerSheets,
} from "../../../controllers/question-Answer/stander-Answer.controller";
import { answerPaperUpload } from "../../../utils/multer";
import { authenticate, authorize } from "../../../middlewares/auth";

const router = express.Router();

router.post(
  "/create",
  authenticate,
  createQuestionPaperAnswer
);

router.post(
  "/image",
  authenticate,
  answerPaperUpload,
  uploadImageController
);

router.post(
  "/getQuestionPaperAnswerBySet",
  authenticate,
  getQuestionPaperAnswerBySelection
);

router.get(
  "/uploads",
  authenticate,
  getQuestionPaperAnswerUploads
);

// ─── APPROVAL WORKFLOW ROUTES ──────────────────────────────────────────────

// Teacher submits answer sheet for review
router.patch(
  "/:answerId/submit",
  authenticate,
  submitAnswerSheet
);

// Admin/Examiner approve
router.patch(
  "/:answerId/approve",
  authenticate,
  authorize(["ADMIN", "EXAMINER"]),
  approveAnswerSheet
);

// Admin/Examiner reject
router.patch(
  "/:answerId/reject",
  authenticate,
  authorize(["ADMIN", "EXAMINER"]),
  rejectAnswerSheet
);

// Admin publish
router.patch(
  "/:answerId/publish",
  authenticate,
  authorize(["ADMIN"]),
  publishAnswerSheet
);

// Get pending answer sheets (for admin/examiner review dashboard)
router.get(
  "/pending",
  authenticate,
  authorize(["ADMIN", "EXAMINER"]),
  getPendingAnswerSheets
);

// Get all answer sheets with optional filters
router.get(
  "/",
  authenticate,
  getAllAnswerSheets
);

export default router;
