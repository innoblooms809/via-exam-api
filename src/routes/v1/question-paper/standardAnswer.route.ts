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
import { ACADEMIC, ADMINS, TEACHERS } from "../../../config/roles";

const router = express.Router();

// Model answers: teachers write and submit (the paper setter only, while it is a draft or sent
// back); the school admin reads, approves, rejects or publishes, and never writes one.
const academic = [authenticate, authorize(ACADEMIC)];
const teachers = [authenticate, authorize(TEACHERS)];
const adminOnly = [authenticate, authorize(ADMINS)];

router.post("/create", ...teachers, createQuestionPaperAnswer);
router.put("/update/:answerId", ...teachers, updateQuestionPaperAnswer);
router.delete("/delete/:answerId", ...teachers, deleteQuestionPaperAnswer);
router.post("/image", ...teachers, answerPaperUpload, uploadImageController);
router.post("/upload-pdf", ...teachers, answerPdfUpload, uploadPdfController);
router.post("/getQuestionPaperAnswerBySet", ...academic, getQuestionPaperAnswerBySelection);
router.get("/uploads", ...adminOnly, getQuestionPaperAnswerUploads);

router.patch("/submitAnswerSheet/:answerId/submit", ...teachers, submitAnswerSheet);
router.patch("/approveAnswerSheet/:answerId/approve", ...adminOnly, approveAnswerSheet);
router.patch("/rejectAnswerSheet/:answerId/reject", ...adminOnly, rejectAnswerSheet);
router.patch("/publishAnswerSheet/:answerId/publish", ...adminOnly, publishAnswerSheet);
router.get("/pending", ...academic, getPendingAnswerSheets);
router.get("/", ...academic, getAllAnswerSheets);

export default router;
