"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const questionPaper_controller_1 = require("../../../controllers/question-Answer/questionPaper.controller");
const multer_1 = require("../../../utils/multer");
const getExamBySelection_1 = require("../../../controllers/exam/getExamBySelection");
const router = (0, express_1.Router)();
// POST /api/viaexam/question-papers
// Body: { instituteId, examId, teacherId, paperSet, content }
// router.post(
//   "/",
//   authenticate,
//   createQuestionPaper
// );
// POST /api/viaexam/question-papers/createQuestionPaper
router.post("/getExamBySelection", 
// authenticate,
getExamBySelection_1.getExamBySelection);
router.post("/createQuestionPaper", 
// authenticate,
questionPaper_controller_1.createQuestionPaper);
router.post("/image", multer_1.questionPaperUpload, questionPaper_controller_1.uploadImageController);
router.get("/uploads", questionPaper_controller_1.getQuestionPaperUploads);
router.post("/getQuestionPaperBySet", questionPaper_controller_1.getQuestionPaperBySelection);
exports.default = router;
