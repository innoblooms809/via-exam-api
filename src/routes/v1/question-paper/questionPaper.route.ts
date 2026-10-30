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
import { ACADEMIC, ADMINS, STAFF, TEACHERS } from "../../../config/roles";

const router = Router();

// Teachers write and submit papers (the paper setter only, while it is a draft or sent back);
// the school admin reads, comments, approves, rejects or publishes, and never writes one.
const academic = [authenticate, authorize(ACADEMIC)];
const teachers = [authenticate, authorize(TEACHERS)];
const adminOnly = [authenticate, authorize(ADMINS)];
const staff = [authenticate, authorize(STAFF)];

router.post("/getExamBySelection", ...staff, getExamBySelection);
router.post("/createQuestionPaper", ...teachers, createQuestionPaper);
router.put("/updateQuestionPaper/:paperId", ...teachers, updateQuestionPaper);
router.delete("/deleteQuestionPaper/:paperId", ...teachers, deleteQuestionPaper);

// Diagram / school-logo images (bytes checked, server-named; see utils/multer)
router.post("/image", ...teachers, questionPaperUpload, uploadImageController);
// Lists every stored question-paper image on the server, so admin only.
router.get("/uploads", ...adminOnly, getQuestionPaperUploads);

router.post("/getQuestionPaperBySet", ...academic, getQuestionPaperBySelection);

// ─── APPROVAL WORKFLOW ──────────────────────────────────────────────────────
router.patch("/submitExamForApproval/:examId/submit", ...teachers, submitExamForApproval);
router.patch("/approveExamPair/:examId/approve", ...adminOnly, approveExamPair);
router.patch("/rejectExamPair/:examId/reject", ...adminOnly, rejectExamPair);
router.patch("/submitQuestionPaper/:paperId/submit", ...teachers, submitQuestionPaper);
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
