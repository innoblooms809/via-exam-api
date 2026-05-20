
// ======================================================
// ROUTE
// src/routes/questionPaperAnswer.routes.ts
// ======================================================

import express from "express";

import {
  createQuestionPaperAnswer,
  uploadImageController,
  getQuestionPaperAnswerBySelection,
  getQuestionPaperAnswerUploads,
} from "../../../controllers/question-Answer/stander-Answer.controller";
import { answerPaperUpload } from "../../../utils/multer";
import { authenticate } from "../../../middlewares/auth";

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

export default router;
