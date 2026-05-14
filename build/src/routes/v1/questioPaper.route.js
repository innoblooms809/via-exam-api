"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const questionPaper_controller_1 = require("../../controllers/questionPaper.controller");
const router = (0, express_1.Router)();
// POST /api/viaexam/question-papers
// Body: { instituteId, examId, teacherId, paperSet, content }
// router.post(
//   "/",
//   authenticate,
//   createQuestionPaper
// );
// POST /api/viaexam/question-papers/createQuestionPaper
router.post("/createQuestionPaper", 
// authenticate,
questionPaper_controller_1.createQuestionPaper);
exports.default = router;
