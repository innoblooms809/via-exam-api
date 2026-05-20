"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const answerSheet_controller_1 = __importDefault(require("../../controllers/answerSheet.controller"));
const auth_1 = require("../middlewares/auth");
const router = (0, express_1.Router)();
// ── Teacher routes ────────────────────────────────────────────────────────────
// Save draft answer sheet
router.post("/", auth_1.authenticate, 
//   authorize(["TEACHER"]),
answerSheet_controller_1.default.saveAnswerSheet);
// Submit for review
router.patch("/:answerSheetId/submit", auth_1.authenticate, 
//   authorize(["TEACHER"]),
answerSheet_controller_1.default.submitAnswerSheet);
// Get my answer sheet for a paper
router.get("/my/:paperId", auth_1.authenticate, 
//   authorize(["TEACHER"]),
answerSheet_controller_1.default.getMyAnswerSheet);
// ── Examiner/Admin routes ─────────────────────────────────────────────────────
// Get all submitted answer sheets
router.get("/submitted", auth_1.authenticate, 
//   authorize(["ADMIN", "EXAMINER"]),
answerSheet_controller_1.default.getSubmittedAnswerSheets);
// Get one answer sheet
router.get("/:answerSheetId", auth_1.authenticate, 
//   authorize(["ADMIN", "EXAMINER"]),
answerSheet_controller_1.default.getAnswerSheetById);
// Approve
router.patch("/:answerSheetId/approve", auth_1.authenticate, 
//   authorize(["ADMIN", "EXAMINER"]),
answerSheet_controller_1.default.approveAnswerSheet);
// Reject with note
router.patch("/:answerSheetId/reject", auth_1.authenticate, 
//   authorize(["ADMIN", "EXAMINER"]),
answerSheet_controller_1.default.rejectAnswerSheet);
exports.default = router;
