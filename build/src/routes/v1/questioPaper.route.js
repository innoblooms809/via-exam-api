"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const questionPaper_controller_1 = __importDefault(require("../../controllers/questionPaper.controller"));
const auth_1 = require("../../middlewares/auth");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────────────────────────
// TEACHER ROUTES
// ─────────────────────────────────────────────────────────────────
// POST /api/viaexam/question-papers
// Teacher creates or updates a question paper draft
// Body: { examId: string, content: object }
router.post("/", auth_1.authenticate, (0, auth_1.authorize)(["teacher"]), questionPaper_controller_1.default.saveDraft);
// PATCH /api/viaexam/question-papers/:paperId/submit
// Teacher submits the draft for examiner review
router.patch("/:paperId/submit", auth_1.authenticate, (0, auth_1.authorize)(["teacher"]), questionPaper_controller_1.default.submitPaper);
// GET /api/viaexam/question-papers/teacher/my-exams
// Teacher sees all exams assigned to them + current paper status
// Query: ?status=Draft|Submitted|Approved|Rejected  ?page=1&limit=10
// ⚠️  Must be defined BEFORE /:paperId routes — "teacher" is not a param
router.get("/teacher/my-exams", auth_1.authenticate, (0, auth_1.authorize)(["teacher"]), questionPaper_controller_1.default.getMyExams);
// ─────────────────────────────────────────────────────────────────
// EXAMINER ROUTES
// ─────────────────────────────────────────────────────────────────
// GET /api/viaexam/question-papers/submitted
// Examiner sees all submitted papers pending review
// Query: ?class=Class 10&subject=Mathematics&page=1&limit=10
// ⚠️  Must be defined BEFORE /:paperId routes — "submitted" is not a param
router.get("/submitted", auth_1.authenticate, (0, auth_1.authorize)(["examiner"]), questionPaper_controller_1.default.getSubmittedPapers);
// PATCH /api/viaexam/question-papers/:paperId/approve
// Examiner approves → paper = Approved, exam = Live
router.patch("/:paperId/approve", auth_1.authenticate, (0, auth_1.authorize)(["examiner"]), questionPaper_controller_1.default.approvePaper);
// PATCH /api/viaexam/question-papers/:paperId/reject
// Examiner rejects → paper = Rejected (with note), exam = Draft
// Body: { rejectionNote: string }
router.patch("/:paperId/reject", auth_1.authenticate, (0, auth_1.authorize)(["examiner"]), questionPaper_controller_1.default.rejectPaper);
exports.default = router;
