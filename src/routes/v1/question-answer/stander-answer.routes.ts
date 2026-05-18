
// ======================================================
// ROUTE
// src/routes/questionPaperAnswer.routes.ts
// ======================================================

import express from "express";

import {
  createQuestionPaperAnswer,
  uploadImageController,
} from "../../../controllers/question-Answer/stander-Answer.controller";
import { answerPaperUpload } from "../../../utils/multer";

const router = express.Router();

router.post(
  "/create",
  createQuestionPaperAnswer
);

router.post(
  "/image",
  answerPaperUpload,
  uploadImageController
);

export default router;

