import express from "express";

import {
  createQuestionPaperAnswer,
  updateQuestionPaperAnswer,
  deleteQuestionPaperAnswer,
  uploadImageController,
  uploadPdfController,
  getQuestionPaperAnswerBySelection,
  getQuestionPaperAnswerUploads,
  submitAnswerSheet,
  approveAnswerSheet,
  rejectAnswerSheet,
  publishAnswerSheet,
  getPendingAnswerSheets,
  getAllAnswerSheets,
} from "../../../controllers/question-paper/standardAnswer.controller";
import { answerPaperUpload, answerPdfUpload } from "../../../utils/multer";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ACADEMIC, ADMINS } from "../../../config/roles";

const router = express.Router();

// Model answers: teachers write and submit; only the school admin approves, rejects or publishes.
const academic = [authenticate, authorize(ACADEMIC)];
const adminOnly = [authenticate, authorize(ADMINS)];

router.post("/create", ...academic, createQuestionPaperAnswer);
router.put("/update/:answerId", ...academic, updateQuestionPaperAnswer);
router.delete("/delete/:answerId", ...academic, deleteQuestionPaperAnswer);
router.post("/image", ...academic, answerPaperUpload, uploadImageController);
router.post("/upload-pdf", ...academic, answerPdfUpload, uploadPdfController);
router.post("/getQuestionPaperAnswerBySet", ...academic, getQuestionPaperAnswerBySelection);
router.get("/uploads", ...adminOnly, getQuestionPaperAnswerUploads);

router.patch("/submitAnswerSheet/:answerId/submit", ...academic, submitAnswerSheet);
router.patch("/approveAnswerSheet/:answerId/approve", ...adminOnly, approveAnswerSheet);
router.patch("/rejectAnswerSheet/:answerId/reject", ...adminOnly, rejectAnswerSheet);
router.patch("/publishAnswerSheet/:answerId/publish", ...adminOnly, publishAnswerSheet);
router.get("/pending", ...academic, getPendingAnswerSheets);
router.get("/", ...academic, getAllAnswerSheets);

export default router;
