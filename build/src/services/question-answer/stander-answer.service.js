"use strict";
// ======================================================
// SERVICE
// src/services/questionPaperAnswer.service.ts
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
const stander_answer_model_1 = __importDefault(require("../../modals/question-paper/stander-answer.model"));
const helper_1 = __importDefault(require("../../utils/helper"));
class QuestionPaperAnswerService {
    // CREATE ANSWER KEY
    static createQuestionPaperAnswer(data) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const existing = yield stander_answer_model_1.default.findOne({
                    where: {
                        paperId: data.paperId,
                        paperSet: data.paperSet,
                    },
                });
                if (existing) {
                    throw new Error("Answer key already exists for this paper set");
                }
                const answerId = yield helper_1.default.generateUserId();
                const result = yield stander_answer_model_1.default.create({
                    answerId,
                    instituteId: data.instituteId,
                    paperId: data.paperId,
                    examId: data.examId,
                    teacherId: data.teacherId,
                    paperSet: data.paperSet,
                    answers: data.answers,
                    status: data.status || "DRAFT",
                });
                return result;
            }
            catch (error) {
                throw new Error(error.message);
            }
        });
    }
}
exports.default = QuestionPaperAnswerService;
