import { Router } from "express";
import {
  createQuestionPaper,
  updateQuestionPaper,
  deleteQuestionPaper,
  getQuestionPaperUploads,
  uploadImageController,
  getQuestionPaperBySelection,
  submitQuestionPaper,
  submitExamForApproval,
  approveQuestionPaper,
  rejectQuestionPaper,
  publishQuestionPaper,
  getPendingQuestionPapers,
  getAllQuestionPapers,
  approveExamPair,
  rejectExamPair,
  getExamRemarksController,
  addExamRemarkController,
} from "../../../controllers/question-paper/questionPaper.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { questionPaperUpload } from "../../../utils/multer";
import { getExamBySelection } from "../../../controllers/exam/getExamBySelection";
import { ACADEMIC, ADMINS } from "../../../config/roles";

const router = Router();

// Teachers write and submit papers; only the school admin approves, rejects or publishes.
const academic = [authenticate, authorize(ACADEMIC)];
const adminOnly = [authenticate, authorize(ADMINS)];

router.post("/getExamBySelection", ...academic, getExamBySelection);
router.post("/createQuestionPaper", ...academic, createQuestionPaper);
router.put("/updateQuestionPaper/:paperId", ...academic, updateQuestionPaper);
router.delete("/deleteQuestionPaper/:paperId", ...academic, deleteQuestionPaper);

// Diagram / school-logo images (bytes checked, server-named; see utils/multer)
router.post("/image", ...academic, questionPaperUpload, uploadImageController);
// Lists every stored question-paper image on the server, so admin only.
router.get("/uploads", ...adminOnly, getQuestionPaperUploads);

router.post("/getQuestionPaperBySet", ...academic, getQuestionPaperBySelection);

// ─── APPROVAL WORKFLOW ──────────────────────────────────────────────────────
router.patch("/submitExamForApproval/:examId/submit", ...academic, submitExamForApproval);
router.patch("/approveExamPair/:examId/approve", ...adminOnly, approveExamPair);
router.patch("/rejectExamPair/:examId/reject", ...adminOnly, rejectExamPair);
router.patch("/submitQuestionPaper/:paperId/submit", ...academic, submitQuestionPaper);
router.patch("/approveQuestionPaper/:paperId/approve", ...adminOnly, approveQuestionPaper);
router.patch("/rejectQuestionPaper/:paperId/reject", ...adminOnly, rejectQuestionPaper);
router.patch("/publishQuestionPaper/:paperId/publish", ...adminOnly, publishQuestionPaper);
router.get("/pending", ...academic, getPendingQuestionPapers);
router.get("/getAllQuestionPapers", ...academic, getAllQuestionPapers);
// A paper's discussion: comments between the admins and the paper setter, and its approval steps.
router.get("/remarks/:examId", ...academic, getExamRemarksController);
router.post("/remarks/:examId", ...academic, addExamRemarkController);
router.get("/exams/:examId/comments", ...academic, getExamRemarksController);
router.post("/exams/:examId/comments", ...academic, addExamRemarkController);

export default router;
