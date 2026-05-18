"use strict";
// ======================================================
// CONTROLLER
// src/controllers/questionPaperAnswer.controller.ts
// ======================================================
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQuestionPaperAnswer = void 0;
const stander_answer_service_1 = __importDefault(require("../../services/question-answer/stander-answer.service"));
const createQuestionPaperAnswer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { instituteId, paperId, examId, teacherId, paperSet, answers, status, } = req.body;
        // BASIC VALIDATION
        if (!instituteId ||
            !paperId ||
            !examId ||
            !teacherId ||
            !paperSet ||
            !answers) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields",
            });
        }
        const result = yield stander_answer_service_1.default.createQuestionPaperAnswer({
            instituteId,
            paperId,
            examId,
            teacherId,
            paperSet,
            answers,
            status,
        });
        return res.status(201).json({
            success: true,
            message: "Question paper answer created successfully",
            data: result,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
});
exports.createQuestionPaperAnswer = createQuestionPaperAnswer;
