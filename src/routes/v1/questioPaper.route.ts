import { Router } from "express";
import { createQuestionPaper, getQuestionPaperSets, uploadImageController,getQuestionPaperBySet } from "../../controllers/questionPaper.controller";
import { authenticate } from "../../middlewares/auth";
import { questionPaperUpload } from "../../utils/multer";
import { getExamBySelection, } from "../../controllers/exam/getExamBySelection";
const router = Router();

// POST /api/viaexam/question-papers
// Body: { instituteId, examId, teacherId, paperSet, content }
// router.post(
//   "/",
//   authenticate,
//   createQuestionPaper
// );

// POST /api/viaexam/question-papers/createQuestionPaper
router.post(
  "/getExamBySelection",
  // authenticate,
  getExamBySelection)



router.post(
  "/createQuestionPaper",
  // authenticate,
  createQuestionPaper
);
router.post(
  "/image",
  questionPaperUpload,
  uploadImageController
);


router.get(
  "/question-paper/sets",
  getQuestionPaperSets
);

// router.get(
//   "/question-paper/content",
//   getQuestionPaperBySet
// );


export default router;
