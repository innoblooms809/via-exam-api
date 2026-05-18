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
const router = express_1.default.Router();
router.post("/create", stander_Answer_controller_1.createQuestionPaperAnswer);
router.post("/image", multer_1.answerPaperUpload, stander_Answer_controller_1.uploadImageController);
exports.default = router;
