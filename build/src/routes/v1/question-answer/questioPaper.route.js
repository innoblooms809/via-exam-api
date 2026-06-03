"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const questionPaper_controller_1 = require("../../../controllers/question-Answer/questionPaper.controller");
const auth_1 = require("../../../middlewares/auth");
const multer_1 = require("../../../utils/multer");
const getExamBySelection_1 = require("../../../controllers/exam/getExamBySelection");
const router = (0, express_1.Router)();
router.post("/getExamBySelection", auth_1.authenticate, getExamBySelection_1.getExamBySelection);
router.post("/createQuestionPaper", auth_1.authenticate, questionPaper_controller_1.createQuestionPaper);
router.post("/image", multer_1.questionPaperUpload, questionPaper_controller_1.uploadImageController);
router.get("/uploads", questionPaper_controller_1.getQuestionPaperUploads);
router.post("/getQuestionPaperBySet", auth_1.authenticate, questionPaper_controller_1.getQuestionPaperBySelection);
// ─── APPROVAL WORKFLOW ROUTES ──────────────────────────────────────────────
// Teacher submits paper for review
router.patch("/submitQuestionPaper/:paperId/submit", auth_1.authenticate, questionPaper_controller_1.submitQuestionPaper);
// Admin/Examiner approve
router.patch("/approveQuestionPaper/:paperId/approve", auth_1.authenticate, 
// authorize(["ADMIN", "EXAMINER"]),
questionPaper_controller_1.approveQuestionPaper);
// Admin/Examiner reject
router.patch("/rejectQuestionPaper/:paperId/reject", auth_1.authenticate, 
// authorize(["ADMIN", "EXAMINER"]),
questionPaper_controller_1.rejectQuestionPaper);
// Admin publish
router.patch("/publishQuestionPaper/:paperId/publish", auth_1.authenticate, 
// authorize(["ADMIN"]),
questionPaper_controller_1.publishQuestionPaper);
// Get pending papers (for admin/examiner review dashboard)
router.get("/pending", auth_1.authenticate, 
// authorize(["ADMIN", "EXAMINER"]),
questionPaper_controller_1.getPendingQuestionPapers);
// Get all papers with optional filters (status, examId, teacherId)
router.get("/getAllQuestionPapers", auth_1.authenticate, questionPaper_controller_1.getAllQuestionPapers);
exports.default = router;
