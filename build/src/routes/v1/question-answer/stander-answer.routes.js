"use strict";
// ======================================================
// ROUTE
// src/routes/questionPaperAnswer.routes.ts
// ======================================================
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
router.post("/getQuestionPaperAnswerBySet", auth_1.authenticate, stander_Answer_controller_1.getQuestionPaperAnswerBySelection);
router.get("/uploads", auth_1.authenticate, stander_Answer_controller_1.getQuestionPaperAnswerUploads);
exports.default = router;
