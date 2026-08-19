"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const stander_Answer_controller_1 = require("../../../controllers/question-Answer/stander-Answer.controller");
const multer_1 = require("../../../utils/multer");
const auth_1 = require("../../../middlewares/auth");
const router = express_1.default.Router();
router.post("/create", auth_1.authenticate, stander_Answer_controller_1.createQuestionPaperAnswer);
router.post("/image", auth_1.authenticate, multer_1.answerPaperUpload, stander_Answer_controller_1.uploadImageController);
router.post("/upload-pdf", auth_1.authenticate, multer_1.answerPdfUpload, stander_Answer_controller_1.uploadPdfController);
router.post("/getQuestionPaperAnswerBySet", auth_1.authenticate, stander_Answer_controller_1.getQuestionPaperAnswerBySelection);
router.get("/uploads", auth_1.authenticate, stander_Answer_controller_1.getQuestionPaperAnswerUploads);
// ─── APPROVAL WORKFLOW ROUTES ──────────────────────────────────────────────
// Teacher submits answer sheet for review
router.patch("/submitAnswerSheet/:answerId/submit", auth_1.authenticate, stander_Answer_controller_1.submitAnswerSheet);
// Admin/Examiner approve
router.patch("/approveAnswerSheet/:answerId/approve", auth_1.authenticate, 
// authorize(["ADMIN", "EXAMINER"]),
stander_Answer_controller_1.approveAnswerSheet);
// Admin/Examiner reject
router.patch("/rejectAnswerSheet/:answerId/reject", auth_1.authenticate, 
// authorize(["ADMIN", "EXAMINER"]),
stander_Answer_controller_1.rejectAnswerSheet);
// Admin publish
router.patch("/publishAnswerSheet/:answerId/publish", auth_1.authenticate, 
// authorize(["ADMIN"]),
stander_Answer_controller_1.publishAnswerSheet);
// Get pending answer sheets (for admin/examiner review dashboard)
router.get("/pending", auth_1.authenticate, 
// authorize(["ADMIN", "EXAMINER"]),
stander_Answer_controller_1.getPendingAnswerSheets);
// Get all answer sheets with optional filters
router.get("/", auth_1.authenticate, stander_Answer_controller_1.getAllAnswerSheets);
exports.default = router;
